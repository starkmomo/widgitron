import Foundation
import WidgetKit

// Loaded into the host app so WidgetKit associates the reload with Widgitron.
@_cdecl("widgitron_reload_widget")
public func widgitron_reload_widget(_ kind: UnsafePointer<CChar>?) {
    guard let kind else { return }
    WidgetCenter.shared.reloadTimelines(ofKind: String(cString: kind))
}
