import UIKit
import Capacitor
import CoreText

// Real iOS Liquid Glass for œnograph's menu and round buttons.
// The web page describes what to show (GlassBar.update); taps go back to the page as "tap" events.
// Glass is drawn by iOS, so it follows the system Liquid Glass setting (Clear / Tinted) by itself.

@objc(GlassBarPlugin)
public class GlassBarPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GlassBarPlugin"
    public let jsName = "GlassBar"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "settings", returnType: CAPPluginReturnPromise)
    ]

    private var overlay: GlassOverlay?
    private var sheet: SettingsSheet?

    // Shows (or updates, or closes when the spec is empty) the native Settings card.
    @objc func settings(_ call: CAPPluginCall) {
        let json = call.getString("spec") ?? ""
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let spec = SheetSpec(json: json)
            if spec == nil {
                if let sh = self.sheet { sh.closedByPage = true; sh.dismiss(animated: true) }
                self.sheet = nil
                call.resolve(); return
            }
            if let sh = self.sheet, sh.presentingViewController != nil {
                sh.apply(spec!)
            } else {
                guard let vc = self.bridge?.viewController else { call.resolve(); return }
                let sh = SettingsSheet(spec: spec!)
                sh.onAction = { [weak self] id, value in self?.notifyListeners("settings", data: ["id": id, "value": value]) }
                sh.onClose = { [weak self] in self?.sheet = nil; self?.notifyListeners("settings", data: ["id": "close", "value": ""]) }
                let nav = UINavigationController(rootViewController: sh)
                if let p = nav.sheetPresentationController {
                    p.detents = [.large()]; p.prefersGrabberVisible = true
                    // Closed iPhone Duo: the card starts just below the camera, not at the very top.
                    if #available(iOS 16.0, *), let w = vc.view.window, SettingsSheet.isDuo(w) {
                        let h = w.bounds.height - 112
                        p.detents = [.custom(identifier: .init("duo")) { ctx in min(h, ctx.maximumDetentValue) }]
                    }
                }
                nav.presentationController?.delegate = sh
                vc.present(nav, animated: true)
                self.sheet = sh
            }
            call.resolve()
        }
    }

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
            // Follow the app's own Appearance choice (Light / Dark / Auto), so glass and sheets match the page.
            let style: UIUserInterfaceStyle = spec.theme == "dark" ? .dark : spec.theme == "light" ? .light : .unspecified
            if let w = host.window, w.overrideUserInterfaceStyle != style { w.overrideUserInterfaceStyle = style }
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
    var menu: [GlassItem] = []   // when set, the button opens this menu (the "•••" button)

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
    var theme = "auto"

    init(json: String) {
        guard let data = json.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
        mode = o["mode"] as? String ?? "off"
        theme = o["theme"] as? String ?? "auto"
        hidden = o["hidden"] as? Bool ?? false
        active = o["active"] as? Int ?? -1
        search = o["search"] as? Bool ?? false
        searchImg = o["searchImg"] as? String ?? ""
        top = o["top"] as? Bool ?? false
        func parse(_ list: [[String: Any]]) -> [GlassItem] {
            return list.map {
                GlassItem(id: $0["id"] as? String ?? "", icon: $0["icon"] as? String ?? "circle", label: $0["label"] as? String ?? "", img: $0["img"] as? String ?? "",
                          menu: parse($0["menu"] as? [[String: Any]] ?? []))
            }
        }
        func items(_ k: String) -> [GlassItem] { return parse(o[k] as? [[String: Any]] ?? []) }
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
        func key(_ i: GlassItem) -> String { return i.id + i.icon + i.label + i.img + i.menu.map { $0.id + $0.label }.joined() }
        let same = new.map(key) == items.map(key)
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
            if item.menu.isEmpty {
                b.addAction(UIAction { [weak self] _ in
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    self?.onTap?(id)
                }, for: .touchUpInside)
            } else {
                b.menu = UIMenu(children: item.menu.map { m in
                    let mid = m.id
                    return UIAction(title: m.label, image: UIImage(systemName: m.icon)) { [weak self] _ in self?.onTap?(mid) }
                })
                b.showsMenuAsPrimaryAction = true
            }
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
        // + , Search and ••• share one capsule; the menu holds only the tabs.
        tabs.setItems(s.tabs)
        actions.setItems(s.actions)
        searchButton.setItems([])
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

// MARK: - Native Settings card
// The page describes the card (sections of pickers, switches and rows); iOS draws it, so it gets real
// Liquid Glass and follows the system Clear / Tinted setting. Taps go back to the page as "settings" events.

struct SheetRow {
    var kind = "row"        // "seg", "toggle", "row", "info", "field"
    var id = ""
    var title = ""
    var subtitle = ""
    var options: [String] = []
    var selected = -1
    var on = false
    var danger = false
    var placeholder = ""
    var button = ""
}

struct SheetSection {
    var header = ""
    var footer = ""
    var rows: [SheetRow] = []
}

struct SheetSpec {
    var title = "Settings"
    var subtitle = ""
    var sections: [SheetSection] = []
    var theme = "auto"
    var accent: UIColor = .systemPink
    var scale: CGFloat = 1          // the app's Text size setting
    var paper: UIColor?
    var card: UIColor?
    var fg: UIColor?
    var mut: UIColor?

    init?(json: String) {
        guard !json.isEmpty, let data = json.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return nil }
        title = o["title"] as? String ?? "Settings"
        subtitle = o["subtitle"] as? String ?? ""
        theme = o["theme"] as? String ?? "auto"
        if let hex = o["accent"] as? String, let c = UIColor(hex: hex) { accent = c }
        if let t = o["ts"] as? Double, t > 0.5, t < 2 { scale = CGFloat(t) }
        let col = o["colors"] as? [String: String] ?? [:]
        paper = col["paper"].flatMap { UIColor(hex: $0) }
        card = col["card"].flatMap { UIColor(hex: $0) }
        fg = col["fg"].flatMap { UIColor(hex: $0) }
        mut = col["mut"].flatMap { UIColor(hex: $0) }
        sections = (o["sections"] as? [[String: Any]] ?? []).map { sd in
            var sec = SheetSection()
            sec.header = sd["header"] as? String ?? ""
            sec.footer = sd["footer"] as? String ?? ""
            sec.rows = (sd["rows"] as? [[String: Any]] ?? []).map { rd in
                var r = SheetRow()
                r.kind = rd["kind"] as? String ?? "row"
                r.id = rd["id"] as? String ?? ""
                r.title = rd["title"] as? String ?? ""
                r.subtitle = rd["subtitle"] as? String ?? ""
                r.options = rd["options"] as? [String] ?? []
                r.selected = rd["selected"] as? Int ?? -1
                r.on = rd["on"] as? Bool ?? false
                r.danger = rd["danger"] as? Bool ?? false
                r.placeholder = rd["placeholder"] as? String ?? ""
                r.button = rd["button"] as? String ?? ""
                return r
            }
            return sec
        }
    }
}

// œnograph's own typefaces (shipped as .ttf next to the web copy), registered once.
enum OenoFont {
    static let registered: Bool = {
        for n in ["italiana", "ebgaramond-500"] {
            if let u = Bundle.main.url(forResource: n, withExtension: "ttf", subdirectory: "public/native-fonts") {
                CTFontManagerRegisterFontsForURL(u as CFURL, .process, nil)
            }
        }
        return true
    }()
    static func display(_ size: CGFloat) -> UIFont { _ = registered; return UIFont(name: "Italiana-Regular", size: size) ?? .systemFont(ofSize: size, weight: .light) }
    static func serif(_ size: CGFloat) -> UIFont { _ = registered; return UIFont(name: "EBGaramond-Medium", size: size) ?? .systemFont(ofSize: size, weight: .medium) }
}

final class SettingsSheet: UITableViewController, UIAdaptivePresentationControllerDelegate, UITextFieldDelegate {
    var spec: SheetSpec
    var onAction: ((String, String) -> Void)?
    var onClose: (() -> Void)?
    var closedByPage = false
    private var notified = false
    private var fieldText: [String: String] = [:]
    private var model: [SheetSection] = []          // what is shown (compacted from the page's sections)
    private let titleLabel = UILabel()
    private let subtitleLabel = UILabel()
    private let header = UIView()
    private let closeButton = UIButton(type: .system)

    init(spec: SheetSpec) {
        self.spec = spec
        super.init(style: .insetGrouped)
    }
    required init?(coder: NSCoder) { fatalError("not used") }

    private func notifyClose() {
        if notified || closedByPage { return }
        notified = true
        onClose?()
    }

    // Pickers with up to 3 choices sit on one line next to their name; longer lists (Language)
    // become a pop-up menu. They share one group at the top, like the iPhone's own Settings.
    private func compact(_ s: SheetSpec) -> [SheetSection] {
        var out: [SheetSection] = []
        var group = SheetSection()
        func flush() { if !group.rows.isEmpty { out.append(group); group = SheetSection() } }
        for sec in s.sections {
            if sec.rows.count == 1, sec.rows[0].kind == "seg" {
                var r = sec.rows[0]
                r.title = sec.header
                r.kind = r.options.count > 3 ? "menu" : "segline"
                group.rows.append(r)
            } else {
                flush()
                out.append(sec)
            }
        }
        flush()
        return out
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        navigationController?.setNavigationBarHidden(true, animated: false)
        tableView.keyboardDismissMode = .interactive
        tableView.sectionHeaderTopPadding = 4
        tableView.contentInset.top = 6

        titleLabel.adjustsFontSizeToFitWidth = true
        titleLabel.minimumScaleFactor = 0.7
        subtitleLabel.numberOfLines = 0
        [titleLabel, subtitleLabel].forEach { $0.translatesAutoresizingMaskIntoConstraints = false; header.addSubview($0) }
        NSLayoutConstraint.activate([
            titleLabel.leadingAnchor.constraint(equalTo: header.leadingAnchor, constant: 20),
            titleLabel.trailingAnchor.constraint(lessThanOrEqualTo: header.trailingAnchor, constant: -76),
            titleLabel.topAnchor.constraint(equalTo: header.topAnchor, constant: 18),
            subtitleLabel.leadingAnchor.constraint(equalTo: titleLabel.leadingAnchor),
            subtitleLabel.trailingAnchor.constraint(equalTo: header.trailingAnchor, constant: -76),
            subtitleLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 2),
            subtitleLabel.bottomAnchor.constraint(equalTo: header.bottomAnchor, constant: -6)
        ])

        var bc: UIButton.Configuration
        if #available(iOS 26.0, *) { bc = .glass() } else { bc = .gray() }
        bc.image = UIImage(systemName: "xmark", withConfiguration: UIImage.SymbolConfiguration(pointSize: 16, weight: .semibold))
        bc.cornerStyle = .capsule
        closeButton.configuration = bc
        closeButton.accessibilityLabel = "Close"
        closeButton.addAction(UIAction { [weak self] _ in self?.dismiss(animated: true) }, for: .touchUpInside)
        view.addSubview(closeButton)

        style()
        model = compact(spec)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        // Header height follows its text.
        let w = tableView.bounds.width
        if w > 0 {
            var h = header.systemLayoutSizeFitting(CGSize(width: w, height: 0), withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel).height
            // On the Duo the close button sits under the clock strip; start the list below it so they never overlap.
            if isDuo { h = max(h, closeTop + 44 + 8) }
            if tableView.tableHeaderView !== header || abs(header.frame.height - h) > 0.5 {
                header.frame = CGRect(x: 0, y: 0, width: w, height: h)
                tableView.tableHeaderView = header
            }
        }
        // Close button: on the closed iPhone Duo it sits in the right-hand column, just below the
        // clock strip (where the + / Search capsule is); elsewhere at the top right.
        let size: CGFloat = 44
        let W = view.bounds.width
        let duo = isDuo
        let x = duo ? (W - 48 - size / 2) : (W - 16 - size)
        let y = closeTop
        closeButton.frame = CGRect(x: x, y: tableView.contentOffset.y + tableView.adjustedContentInset.top + y - tableView.adjustedContentInset.top, width: size, height: size)
        view.bringSubviewToFront(closeButton)
    }

    static func isDuo(_ w: UIWindow) -> Bool { w.bounds.width >= 450 && w.bounds.width <= 480 && w.bounds.height <= 720 }
    private var isDuo: Bool { view.window.map { SettingsSheet.isDuo($0) } ?? false }
    // Top of the close button inside the card: just below the clock strip on the Duo (strip ends ~161pt).
    private var closeTop: CGFloat {
        guard isDuo else { return 14 }
        // Where the card's top rests (from its height, so it stays steady while the card slides in).
        guard let w = view.window else { return 60 }
        let originY = w.bounds.height - (navigationController?.view.bounds.height ?? view.bounds.height)
        return max(12, 168 - originY)
    }

    override func scrollViewDidScroll(_ scrollView: UIScrollView) {
        view.setNeedsLayout()   // keep the close button in place while the list scrolls
    }

    // The page re-sends the card after every change. If only values changed, refresh just the
    // rows whose text changed and leave pickers and switches alone so their own animation finishes.
    private func sameShape(_ a: [SheetSection], _ b: [SheetSection]) -> Bool {
        guard a.count == b.count else { return false }
        for (x, y) in zip(a, b) {
            if x.rows.count != y.rows.count || x.header != y.header || x.footer != y.footer { return false }
            for (p, q) in zip(x.rows, y.rows) where p.kind != q.kind || p.id != q.id || p.options != q.options || p.title != q.title { return false }
        }
        return true
    }

    func apply(_ s: SheetSpec) {
        let old = spec
        let oldModel = model
        spec = s
        guard isViewLoaded else { return }
        style()
        let new = compact(s)
        model = new
        let look = old.scale != s.scale || old.theme != s.theme || old.paper != s.paper || old.card != s.card || old.fg != s.fg
        if !look && sameShape(oldModel, new) {
            var changed: [IndexPath] = []
            for (si, sec) in new.enumerated() {
                for (ri, row) in sec.rows.enumerated() where ["row", "info"].contains(row.kind) {
                    let o = oldModel[si].rows[ri]
                    if o.subtitle != row.subtitle || o.danger != row.danger { changed.append(IndexPath(row: ri, section: si)) }
                }
            }
            if !changed.isEmpty { tableView.reloadRows(at: changed, with: .none) }
            // A pop-up menu shows its current choice in its title: refresh it in place.
            for (si, sec) in new.enumerated() {
                for (ri, row) in sec.rows.enumerated() where row.kind == "menu" && oldModel[si].rows[ri].selected != row.selected {
                    tableView.reloadRows(at: [IndexPath(row: ri, section: si)], with: .none)
                }
            }
        } else {
            tableView.reloadData()
        }
    }

    private func style() {
        let s = spec
        let style: UIUserInterfaceStyle = s.theme == "dark" ? .dark : s.theme == "light" ? .light : .unspecified
        navigationController?.overrideUserInterfaceStyle = style
        overrideUserInterfaceStyle = style
        view.tintColor = s.accent
        titleLabel.text = s.title
        titleLabel.font = OenoFont.display(40 * s.scale)
        titleLabel.textColor = s.fg ?? .label
        subtitleLabel.text = s.subtitle
        subtitleLabel.font = .systemFont(ofSize: 14 * s.scale)
        subtitleLabel.textColor = s.mut ?? .secondaryLabel
        closeButton.tintColor = s.fg ?? .label
        tableView.backgroundColor = s.paper ?? .systemGroupedBackground
        navigationController?.view.backgroundColor = s.paper
        view.setNeedsLayout()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if navigationController?.isBeingDismissed ?? isBeingDismissed { notifyClose() }
    }
    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) { notifyClose() }

    override func numberOfSections(in tableView: UITableView) -> Int { return model.count }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { return model[section].rows.count }

    override func tableView(_ tableView: UITableView, viewForHeaderInSection section: Int) -> UIView? {
        let h = model[section].header
        if h.isEmpty { return nil }
        let v = UIView()
        let l = UILabel()
        l.text = h
        l.font = OenoFont.serif(18 * spec.scale)
        l.textColor = spec.fg ?? .label
        l.translatesAutoresizingMaskIntoConstraints = false
        v.addSubview(l)
        NSLayoutConstraint.activate([
            l.leadingAnchor.constraint(equalTo: v.layoutMarginsGuide.leadingAnchor, constant: 4),
            l.trailingAnchor.constraint(equalTo: v.layoutMarginsGuide.trailingAnchor),
            l.topAnchor.constraint(equalTo: v.topAnchor, constant: 8),
            l.bottomAnchor.constraint(equalTo: v.bottomAnchor, constant: -4)
        ])
        return v
    }
    override func tableView(_ tableView: UITableView, heightForHeaderInSection section: Int) -> CGFloat {
        return model[section].header.isEmpty ? 10 : UITableView.automaticDimension
    }
    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        let f = model[section].footer
        return f.isEmpty ? nil : f
    }
    override func tableView(_ tableView: UITableView, willDisplayFooterView view: UIView, forSection section: Int) {
        guard let f = view as? UITableViewHeaderFooterView else { return }
        var c = f.defaultContentConfiguration()
        c.text = model[section].footer
        c.textProperties.font = .systemFont(ofSize: 12.5 * spec.scale)
        c.textProperties.color = spec.mut ?? .secondaryLabel
        f.contentConfiguration = c
    }

    private func label(_ text: String) -> UILabel {
        let l = UILabel()
        l.text = text
        l.font = .systemFont(ofSize: 16 * spec.scale)
        l.textColor = spec.fg ?? .label
        l.translatesAutoresizingMaskIntoConstraints = false
        l.setContentHuggingPriority(.required, for: .horizontal)
        return l
    }

    override func tableView(_ tableView: UITableView, cellForRowAt ip: IndexPath) -> UITableViewCell {
        let r = model[ip.section].rows[ip.row]
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        cell.backgroundColor = spec.card
        cell.tintColor = spec.accent
        let g = cell.contentView.layoutMarginsGuide
        var c = cell.defaultContentConfiguration()
        c.text = r.title
        c.secondaryText = r.subtitle.isEmpty ? nil : r.subtitle
        c.textProperties.font = .systemFont(ofSize: 16 * spec.scale)
        c.textProperties.color = spec.fg ?? .label
        c.secondaryTextProperties.font = .systemFont(ofSize: 13 * spec.scale)
        c.secondaryTextProperties.color = spec.mut ?? .secondaryLabel
        c.textToSecondaryTextVerticalPadding = 2
        c.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 9, leading: 0, bottom: 9, trailing: 0)
        let id = r.id

        switch r.kind {
        case "segline":
            cell.selectionStyle = .none
            let name = label(r.title)
            let seg = UISegmentedControl(items: r.options)
            seg.selectedSegmentIndex = r.selected
            seg.translatesAutoresizingMaskIntoConstraints = false
            seg.setTitleTextAttributes([.font: UIFont.systemFont(ofSize: 13 * spec.scale, weight: .medium)], for: .normal)
            seg.setTitleTextAttributes([.font: UIFont.systemFont(ofSize: 13 * spec.scale, weight: .semibold)], for: .selected)
            seg.addAction(UIAction { [weak self] a in
                guard let sc = a.sender as? UISegmentedControl else { return }
                UISelectionFeedbackGenerator().selectionChanged()
                self?.onAction?(id, String(sc.selectedSegmentIndex))
            }, for: .valueChanged)
            cell.contentView.addSubview(name)
            cell.contentView.addSubview(seg)
            NSLayoutConstraint.activate([
                name.leadingAnchor.constraint(equalTo: g.leadingAnchor),
                name.centerYAnchor.constraint(equalTo: cell.contentView.centerYAnchor),
                seg.leadingAnchor.constraint(greaterThanOrEqualTo: name.trailingAnchor, constant: 12),
                seg.trailingAnchor.constraint(equalTo: g.trailingAnchor),
                seg.topAnchor.constraint(equalTo: cell.contentView.topAnchor, constant: 7),
                seg.bottomAnchor.constraint(equalTo: cell.contentView.bottomAnchor, constant: -7)
            ])
            return cell
        case "menu":
            cell.selectionStyle = .none
            let name = label(r.title)
            var bc = UIButton.Configuration.plain()
            bc.title = r.selected >= 0 && r.selected < r.options.count ? r.options[r.selected] : ""
            bc.image = UIImage(systemName: "chevron.up.chevron.down", withConfiguration: UIImage.SymbolConfiguration(pointSize: 11, weight: .semibold))
            bc.imagePlacement = .trailing
            bc.imagePadding = 5
            bc.contentInsets = NSDirectionalEdgeInsets(top: 4, leading: 8, bottom: 4, trailing: 0)
            bc.baseForegroundColor = spec.mut ?? .secondaryLabel
            bc.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { [scale = spec.scale] a in
                var a = a; a.font = UIFont.systemFont(ofSize: 16 * scale); return a
            }
            let b = UIButton(configuration: bc)
            b.translatesAutoresizingMaskIntoConstraints = false
            b.menu = UIMenu(children: r.options.enumerated().map { (i, o) in
                UIAction(title: o, state: i == r.selected ? .on : .off) { [weak self] _ in
                    UISelectionFeedbackGenerator().selectionChanged()
                    self?.onAction?(id, String(i))
                }
            })
            b.showsMenuAsPrimaryAction = true
            cell.contentView.addSubview(name)
            cell.contentView.addSubview(b)
            NSLayoutConstraint.activate([
                name.leadingAnchor.constraint(equalTo: g.leadingAnchor),
                name.centerYAnchor.constraint(equalTo: cell.contentView.centerYAnchor),
                b.trailingAnchor.constraint(equalTo: g.trailingAnchor),
                b.centerYAnchor.constraint(equalTo: cell.contentView.centerYAnchor),
                b.leadingAnchor.constraint(greaterThanOrEqualTo: name.trailingAnchor, constant: 12),
                cell.contentView.heightAnchor.constraint(greaterThanOrEqualToConstant: 46)
            ])
            return cell
        case "toggle":
            cell.selectionStyle = .none
            let sw = UISwitch()
            sw.isOn = r.on
            sw.onTintColor = spec.accent
            sw.addAction(UIAction { [weak self] a in
                guard let s = a.sender as? UISwitch else { return }
                self?.onAction?(id, s.isOn ? "1" : "0")
            }, for: .valueChanged)
            cell.accessoryView = sw
        case "info":
            cell.selectionStyle = .none
        case "field":
            cell.selectionStyle = .none
            let tf = UITextField()
            tf.placeholder = r.placeholder
            tf.isSecureTextEntry = true
            tf.autocapitalizationType = .none
            tf.autocorrectionType = .no
            tf.font = .systemFont(ofSize: 16 * spec.scale)
            tf.text = fieldText[id]
            tf.translatesAutoresizingMaskIntoConstraints = false
            tf.delegate = self
            tf.accessibilityIdentifier = id
            tf.addAction(UIAction { [weak self] a in
                guard let t = a.sender as? UITextField, let k = t.accessibilityIdentifier else { return }
                self?.fieldText[k] = t.text ?? ""
            }, for: .editingChanged)
            var bc: UIButton.Configuration
            if #available(iOS 26.0, *) { bc = .glass() } else { bc = .tinted() }
            bc.title = r.button
            let b = UIButton(configuration: bc)
            b.translatesAutoresizingMaskIntoConstraints = false
            b.addAction(UIAction { [weak self] _ in
                self?.view.endEditing(true)
                self?.onAction?(id, self?.fieldText[id] ?? "")
            }, for: .touchUpInside)
            cell.contentView.addSubview(tf)
            cell.contentView.addSubview(b)
            NSLayoutConstraint.activate([
                tf.leadingAnchor.constraint(equalTo: g.leadingAnchor),
                tf.centerYAnchor.constraint(equalTo: cell.contentView.centerYAnchor),
                b.leadingAnchor.constraint(equalTo: tf.trailingAnchor, constant: 10),
                b.trailingAnchor.constraint(equalTo: g.trailingAnchor),
                b.topAnchor.constraint(equalTo: cell.contentView.topAnchor, constant: 6),
                b.bottomAnchor.constraint(equalTo: cell.contentView.bottomAnchor, constant: -6)
            ])
            b.setContentHuggingPriority(.required, for: .horizontal)
            b.setContentCompressionResistancePriority(.required, for: .horizontal)
            return cell
        default:
            c.textProperties.color = r.danger ? .systemRed : (spec.fg ?? .label)
            cell.accessoryType = r.danger ? .none : .disclosureIndicator
        }
        cell.contentConfiguration = c
        return cell
    }

    override func tableView(_ tableView: UITableView, didSelectRowAt ip: IndexPath) {
        tableView.deselectRow(at: ip, animated: true)
        let r = model[ip.section].rows[ip.row]
        if r.kind == "row" { onAction?(r.id, "") }
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        textField.resignFirstResponder()
        if let k = textField.accessibilityIdentifier { onAction?(k, fieldText[k] ?? "") }
        return true
    }
}
