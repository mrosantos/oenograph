import UIKit
import Capacitor

// The app's main screen: the website, plus œnograph's own native pieces.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(GlassBarPlugin())
    }
}
