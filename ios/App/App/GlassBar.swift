import UIKit
import Capacitor

// Real iOS Liquid Glass for œnograph's menu and round buttons.
// The web page describes what to show (GlassBar.update); taps go back to the page as "tap" events.
// Glass is drawn by iOS, so it follows the system Liquid Glass setting (Clear / Tinted) by itself.

@objc(GlassBarPlugin)
public class GlassBarPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GlassBarPlugin"
    public let jsName = "GlassBar"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise)
    ]

    private var overlay: GlassOverlay?

    @objc func update(_ call: CAPPluginCall) {
        let json = call.getString("spec") ?? "{}"
        let spec = GlassSpec(json: json)
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            guard let host = self.bridge?.viewController?.view else { call.resolve(["info": "no host view"]); return }
            if self.overlay == nil {
                let o = GlassOverlay(frame: host.bounds)
                o.autoresizingMask = [.flexibleWidth, .flexibleHeight]
                o.onTap = { [weak self] id in self?.notifyListeners("tap", data: ["id": id]) }
                host.addSubview(o)
                self.overlay = o
            }
            if let o = self.overlay {
                host.bringSubviewToFront(o)
                o.frame = host.bounds
                o.apply(spec)
                o.layoutIfNeeded()
                func r(_ v: UIView) -> String { let f = v.frame; return "\(Int(f.minX)),\(Int(f.minY)) \(Int(f.width))x\(Int(f.height)) a\(v.alpha)" }
                call.resolve(["info": "\(spec.mode) host \(Int(host.bounds.width))x\(Int(host.bounds.height)) tabs[\(r(o.tabs))] actions[\(r(o.actions))]"])
            } else {
                call.resolve(["info": "no overlay"])
            }
        }
    }
}

struct GlassItem {
    let id: String
    let icon: String
    let label: String
    var img: String = ""

    // The app's own icon (a PNG drawn by the page), or an SF Symbol until it arrives.
    func image(size: CGFloat) -> UIImage? {
        if !img.isEmpty, let d = Data(base64Encoded: img), let i = UIImage(data: d, scale: 3) {
            let r = UIGraphicsImageRenderer(size: CGSize(width: size, height: size))
            return r.image { _ in i.draw(in: CGRect(x: 0, y: 0, width: size, height: size)) }.withRenderingMode(.alwaysTemplate)
        }
        return UIImage(systemName: icon, withConfiguration: UIImage.SymbolConfiguration(pointSize: size * 0.8, weight: .regular))
    }
}

struct GlassSpec {
    var mode = "off"          // "duo" (iPhone Duo closed), "bottom" (iPhone upright), "off"
    var hidden = false
    var active = -1
    var tabs: [GlassItem] = []
    var actions: [GlassItem] = []
    var search = false
    var searchImg = ""
    var top = false
    var accent: UIColor = .systemPink

    init(json: String) {
        guard let data = json.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
        mode = o["mode"] as? String ?? "off"
        hidden = o["hidden"] as? Bool ?? false
        active = o["active"] as? Int ?? -1
        search = o["search"] as? Bool ?? false
        searchImg = o["searchImg"] as? String ?? ""
        top = o["top"] as? Bool ?? false
        func items(_ k: String) -> [GlassItem] {
            return (o[k] as? [[String: Any]] ?? []).map {
                GlassItem(id: $0["id"] as? String ?? "", icon: $0["icon"] as? String ?? "circle", label: $0["label"] as? String ?? "", img: $0["img"] as? String ?? "")
            }
        }
        tabs = items("tabs")
        actions = items("actions")
        if let hex = o["accent"] as? String, let c = UIColor(hex: hex) { accent = c }
    }
}

extension UIColor {
    convenience init?(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        self.init(red: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: 1)
    }
}

// One glass capsule holding a row or column of buttons.
final class GlassGroup: UIView {
    let effectView: UIVisualEffectView
    let selection = UIView()
    private(set) var buttons: [UIButton] = []
    private(set) var items: [GlassItem] = []
    var vertical = true
    var showLabels = false
    var selectedIndex = -1
    var accent: UIColor = .systemPink
    var plainTint: UIColor?
    var onTap: ((String) -> Void)?

    override init(frame: CGRect) {
        effectView = UIVisualEffectView(effect: GlassGroup.makeEffect())
        super.init(frame: frame)
        effectView.frame = bounds
        effectView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        effectView.clipsToBounds = true
        effectView.layer.cornerCurve = .continuous
        addSubview(effectView)
        selection.isUserInteractionEnabled = false
        selection.layer.cornerCurve = .continuous
        selection.backgroundColor = UIColor { t in
            t.userInterfaceStyle == .dark ? UIColor.white.withAlphaComponent(0.12) : UIColor.black.withAlphaComponent(0.07)
        }
        effectView.contentView.addSubview(selection)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    static func makeEffect() -> UIVisualEffect {
        if #available(iOS 26.0, *) {
            let glass = UIGlassEffect(style: .regular)
            glass.isInteractive = true
            return glass
        }
        return UIBlurEffect(style: .systemChromeMaterial)
    }

    func setItems(_ new: [GlassItem]) {
        let same = new.map { $0.id + $0.icon + $0.label + $0.img } == items.map { $0.id + $0.icon + $0.label + $0.img }
        if same { return }
        buttons.forEach { $0.removeFromSuperview() }
        items = new
        buttons = new.map { item in
            let b = UIButton(type: .system)
            var c = UIButton.Configuration.plain()
            c.image = item.image(size: showLabels ? 24 : 26)
            if showLabels {
                c.title = item.label
                c.imagePlacement = .top
                c.imagePadding = 3
                c.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { a in
                    var a = a
                    a.font = UIFont.systemFont(ofSize: 10, weight: .semibold)
                    return a
                }
            }
            c.contentInsets = .zero
            b.configuration = c
            b.accessibilityLabel = item.label
            let id = item.id
            b.addAction(UIAction { [weak self] _ in
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                self?.onTap?(id)
            }, for: .touchUpInside)
            effectView.contentView.addSubview(b)
            return b
        }
        setNeedsLayout()
    }

    // Size this group needs for a given cell size.
    func length(cell: CGFloat) -> CGFloat { return CGFloat(max(items.count, 1)) * cell + 8 }

    override func layoutSubviews() {
        super.layoutSubviews()
        let r = min(bounds.width, bounds.height) / 2
        effectView.layer.cornerRadius = r
        let n = CGFloat(max(buttons.count, 1))
        let inset: CGFloat = 4
        for (i, b) in buttons.enumerated() {
            if vertical {
                let h = (bounds.height - inset * 2) / n
                b.frame = CGRect(x: inset, y: inset + CGFloat(i) * h, width: bounds.width - inset * 2, height: h)
            } else {
                let w = (bounds.width - inset * 2) / n
                b.frame = CGRect(x: inset + CGFloat(i) * w, y: inset, width: w, height: bounds.height - inset * 2)
            }
            b.tintColor = i == selectedIndex ? accent : (plainTint ?? .label)
        }
        if selectedIndex >= 0 && selectedIndex < buttons.count {
            selection.isHidden = false
            selection.frame = buttons[selectedIndex].frame
            selection.layer.cornerRadius = min(selection.frame.width, selection.frame.height) / 2
        } else {
            selection.isHidden = true
        }
    }
}

// Full-screen see-through layer that holds the glass groups; touches elsewhere go to the page.
final class GlassOverlay: UIView {
    let tabs = GlassGroup()
    let actions = GlassGroup()
    let searchButton = GlassGroup()
    let topButton = GlassGroup()   // "Back to top", shown once the list is scrolled down
    var spec = GlassSpec(json: "{}")
    var onTap: ((String) -> Void)? {
        didSet { [tabs, actions, searchButton, topButton].forEach { $0.onTap = onTap } }
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        [tabs, actions, searchButton, topButton].forEach { addSubview($0) }
        topButton.alpha = 0
        topButton.transform = CGAffineTransform(scaleX: 0.6, y: 0.6)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let v = super.hitTest(point, with: event)
        return v === self ? nil : v
    }

    func apply(_ s: GlassSpec) {
        let wasHidden = spec.hidden || spec.mode == "off"
        spec = s
        let duo = s.mode == "duo"
        tabs.vertical = duo
        actions.vertical = duo
        tabs.showLabels = !duo
        var tabItems = s.tabs
        if duo && s.search { tabItems.append(GlassItem(id: "search", icon: "magnifyingglass", label: "Search", img: s.searchImg)) }
        tabs.setItems(tabItems)
        actions.setItems(s.actions)
        searchButton.setItems(!duo && s.search ? [GlassItem(id: "search", icon: "magnifyingglass", label: "Search", img: s.searchImg)] : [])
        topButton.showLabels = true
        topButton.setItems([GlassItem(id: "top", icon: "chevron.up", label: "Top")])
        [tabs, actions, searchButton, topButton].forEach { $0.accent = s.accent }
        topButton.plainTint = s.accent
        tabs.selectedIndex = s.active
        let hide = s.hidden || s.mode == "off"
        let animate = wasHidden != hide
        UIView.animate(withDuration: animate ? 0.25 : 0.0) {
            self.tabs.alpha = hide ? 0 : 1
            self.searchButton.alpha = hide || duo || !s.search ? 0 : 1
            self.actions.alpha = hide || s.actions.isEmpty ? 0 : 1
        }
        let showTop = !hide && s.top
        if (topButton.alpha > 0.5) != showTop {
            UIView.animate(withDuration: 0.25) {
                self.topButton.alpha = showTop ? 1 : 0
                self.topButton.transform = showTop ? .identity : CGAffineTransform(scaleX: 0.6, y: 0.6)
            }
        }
        topButton.isUserInteractionEnabled = showTop
        tabs.isUserInteractionEnabled = !hide
        actions.isUserInteractionEnabled = !hide
        searchButton.isUserInteractionEnabled = !hide
        UIView.animate(withDuration: 0.35, delay: 0, usingSpringWithDamping: 0.8, initialSpringVelocity: 0) {
            self.setNeedsLayout()
            self.layoutIfNeeded()
            [self.tabs, self.actions, self.searchButton, self.topButton].forEach { $0.setNeedsLayout(); $0.layoutIfNeeded() }
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let W = bounds.width, H = bounds.height
        let safe = safeAreaInsets
        if spec.mode == "duo" {
            // Centred under the WiFi icon of the clock strip, like the system apps.
            let cx = W - 48, w: CGFloat = 50, cell: CGFloat = 50
            let ah = actions.length(cell: cell)
            actions.frame = CGRect(x: cx - w / 2, y: 172, width: w, height: ah)
            let th = tabs.length(cell: cell)
            tabs.frame = CGRect(x: cx - w / 2, y: H - max(safe.bottom, 12) - 6 - th, width: w, height: th)
            topButton.bounds = CGRect(x: 0, y: 0, width: w, height: w)
            topButton.center = CGPoint(x: cx, y: tabs.frame.minY - 10 - w / 2)
        } else {
            let h: CGFloat = 62, side: CGFloat = 16, gap: CGFloat = 10
            let y = H - max(safe.bottom, 12) - h + 4
            let hasSearch = searchButton.items.count > 0
            let right = hasSearch ? W - side - h - gap : W - side
            tabs.frame = CGRect(x: side, y: y, width: right - side, height: h)
            searchButton.frame = CGRect(x: W - side - h, y: y, width: h, height: h)
            let ah: CGFloat = 44
            let aw = CGFloat(max(actions.items.count, 1)) * 44 + 8
            actions.frame = CGRect(x: W - side - aw, y: safe.top + 14, width: aw, height: ah)
            topButton.bounds = CGRect(x: 0, y: 0, width: 50, height: 50)
            topButton.center = CGPoint(x: W - side - 25, y: y - 12 - 25)
        }
    }
}
