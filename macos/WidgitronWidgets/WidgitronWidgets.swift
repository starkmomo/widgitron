import Foundation
import SwiftUI
import WidgetKit

private let appGroup = Bundle.main.object(forInfoDictionaryKey: "WidgitronAppGroupIdentifier") as? String
    ?? "group.com.evan.widgitron"
private let quotaWidgetKind = "com.evan.widgitron.quota"
private let gpuWidgetKind = "com.evan.widgitron.gpu"
private let deadlineWidgetKind = "com.evan.widgitron.deadlines"
private let quotaAppURL = URL(string: "widgitron://open/quota")
private let quotaRefreshURL = URL(string: "widgitron://open/quota?refresh=1")!
private let gpuAppURL = URL(string: "widgitron://open/gpu")
private let deadlineAppURL = URL(string: "widgitron://open/deadlines")
private let snapshotBaseURL = URL(string: "http://127.0.0.1:42837")!

// WidgetKit supplies Liquid Glass when the user chooses a clear appearance.
// Keep the background removable and use primary/accent groups so the system
// can preserve contrast over wallpaper in both accented and vibrant modes.
private struct WidgetColors {
    let mode: WidgetRenderingMode
    var accent: Color { mode == .fullColor ? .accentColor : .primary }
    var secondary: Color { mode == .fullColor ? .secondary : .primary.opacity(0.85) }
    var progress: Color { mode == .fullColor ? .mint : .primary }
    var warning: Color { mode == .fullColor ? .orange : .primary }
}

private func cachedSnapshotURL(_ file: String) -> URL? {
    FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)
        .first?.appendingPathComponent("widget-snapshots", isDirectory: true)
        .appendingPathComponent(file)
}

private func readSnapshot<T: Decodable>(_ file: String) -> T? {
    let shared = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
        .map { $0.appendingPathComponent(file) }
    for url in [shared, cachedSnapshotURL(file)].compactMap({ $0 }) {
        if let data = try? Data(contentsOf: url), let snapshot = try? JSONDecoder().decode(T.self, from: data) {
            return snapshot
        }
    }
    return nil
}

private func loadSnapshot<T: Decodable>(_ file: String, as type: T.Type, completion: @escaping (T?) -> Void) {
    var request = URLRequest(url: snapshotBaseURL.appendingPathComponent(file))
    request.timeoutInterval = 2
    URLSession.shared.dataTask(with: request) { data, response, _ in
        if let response = response as? HTTPURLResponse, response.statusCode == 200,
           let data, let snapshot = try? JSONDecoder().decode(T.self, from: data) {
            if let cache = cachedSnapshotURL(file) {
                try? FileManager.default.createDirectory(at: cache.deletingLastPathComponent(), withIntermediateDirectories: true)
                try? data.write(to: cache, options: .atomic)
            }
            completion(snapshot)
        } else {
            completion(readSnapshot(file))
        }
    }.resume()
}

private struct QuotaSnapshot: Decodable {
    let language: String
    let showPlanType: Bool
    let items: [QuotaItem]

    enum CodingKeys: String, CodingKey {
        case language, items
        case showPlanType = "show_plan_type"
    }
}

private struct QuotaBar: Decodable {
    let name: String
    let value: Double
    let reset: String?
}

private struct QuotaItem: Decodable {
    let name: String
    let provider: String
    let currentValue: Double?
    let maxQuota: Double?
    let unit: String?
    let primaryName: String?
    let primaryReset: String?
    let bars: [QuotaBar]?
    let lastUpdate: String?
    let planType: String?
    let errorMessage: String?

    enum CodingKeys: String, CodingKey {
        case name, provider, unit, bars
        case currentValue = "current_value"
        case maxQuota = "max_quota"
        case primaryName = "primary_name"
        case primaryReset = "primary_reset"
        case lastUpdate = "last_update"
        case planType = "plan_type"
        case errorMessage = "error_msg"
    }

    var progress: Double? {
        guard let currentValue, let maxQuota, maxQuota > 0 else { return nil }
        return min(max(currentValue / maxQuota, 0), 1)
    }

    var amount: String? {
        guard let currentValue else { return nil }
        if unit == "%" { return "\(Int(currentValue.rounded()))%" }
        let number = currentValue.formatted(.number.precision(.fractionLength(0...1)))
        return [number, unit].compactMap { $0 }.joined(separator: " ")
    }

    var visibleBars: [QuotaBar] {
        let windows = bars ?? []
        let standardNames = ["5h Usage", "7d Usage"]
        let standard = standardNames.compactMap { name in windows.first { $0.name == name } }
        return Array((standard + windows.filter { !standardNames.contains($0.name) }).prefix(2))
    }

    var cardReset: String? {
        visibleBars.isEmpty || provider == "cursor" || provider == "copilot" ? primaryReset : nil
    }

    var resetTimes: [Date] {
        ([cardReset] + visibleBars.map(\.reset)).compactMap { $0.flatMap(QuotaTime.date) }
    }
}

private enum QuotaTime {
    static let minute: TimeInterval = 60
    static let hour = 60 * minute

    private static let localFormatters = ["yyyy-MM-dd HH:mm", "yyyy-MM-dd HH:mm:ss"].map { format in
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = format
        return formatter
    }

    private static let isoFormatters = [false, true].map { fractional in
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = fractional ? [.withInternetDateTime, .withFractionalSeconds] : [.withInternetDateTime]
        return formatter
    }

    static func date(_ text: String) -> Date? {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let iso = value.replacingOccurrences(of: " ", with: "T")
        if value.count == 16 || value.count == 19 {
            return localFormatters[value.count == 16 ? 0 : 1].date(from: iso.replacingOccurrences(of: "T", with: " "))
        }
        return isoFormatters.lazy.compactMap { $0.date(from: iso) }.first
    }

    static func countdown(_ reset: String, at now: Date, chinese: Bool) -> String {
        guard let target = date(reset) else { return chinese ? "重置：\(reset)" : "Reset: \(reset)" }
        let remaining = target.timeIntervalSince(now)
        guard remaining > 0 else { return chinese ? "重置时间已到" : "Reset due" }
        let hours = Int(remaining / hour)
        if hours == 0 {
            let minutes = Int(remaining / minute)
            return minutes > 0 ? "\(minutes)m" : "<1m"
        }
        let days = hours / 24
        let hoursAfterDays = hours % 24
        return (days > 0 ? "\(days)d" : "") + (hoursAfterDays > 0 ? "\(hoursAfterDays)h" : "")
    }

    static func shortUpdate(_ value: String) -> String {
        let parts = value.split(whereSeparator: { $0 == " " || $0 == "T" })
        guard let time = parts.dropFirst().first, time.contains(":") else { return value }
        return String(time.prefix(5))
    }
}

private struct QuotaEntry: TimelineEntry {
    let date: Date
    let snapshot: QuotaSnapshot?
}

private struct QuotaProvider: TimelineProvider {
    func placeholder(in context: Context) -> QuotaEntry {
        let now = Date.now
        return QuotaEntry(date: now, snapshot: QuotaSnapshot(
            language: "zh-CN", showPlanType: true,
            items: [QuotaItem(name: "Codex", provider: "codex", currentValue: 55,
                              maxQuota: 100, unit: "%", primaryName: "7d Usage",
                              primaryReset: nil,
                              bars: [
                                QuotaBar(name: "5h Usage", value: 80, reset: now.addingTimeInterval(45 * 60 + 30).ISO8601Format()),
                                QuotaBar(name: "7d Usage", value: 55, reset: now.addingTimeInterval(166 * 3600 + 30).ISO8601Format()),
                              ],
                              lastUpdate: now.ISO8601Format(),
                              planType: "Pro", errorMessage: nil)]))
    }

    func getSnapshot(in context: Context, completion: @escaping (QuotaEntry) -> Void) {
        if context.isPreview { completion(placeholder(in: context)); return }
        loadSnapshot("quota-snapshot.json", as: QuotaSnapshot.self) { snapshot in
            completion(QuotaEntry(date: .now, snapshot: snapshot))
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<QuotaEntry>) -> Void) {
        loadSnapshot("quota-snapshot.json", as: QuotaSnapshot.self) { snapshot in
            let now = Date.now
            let count = context.family == .systemSmall ? 1 : 2
            let resets = (snapshot?.items ?? []).prefix(count).flatMap(\.resetTimes)
            let spacing = 5 * QuotaTime.minute
            let horizon = now.addingTimeInterval(6 * QuotaTime.hour)
            var updates: Set<Date> = [now]
            for reset in resets {
                var date = now
                while reset > date {
                    let remaining = reset.timeIntervalSince(date)
                    let unit = remaining < QuotaTime.hour ? QuotaTime.minute : QuotaTime.hour
                    let nextChange = min(remaining, remaining.truncatingRemainder(dividingBy: unit) + 1)
                    // Coalesce changes into WidgetKit's five-minute timeline spacing.
                    let slot = ceil((date.timeIntervalSince(now) + nextChange) / spacing)
                    date = now.addingTimeInterval(slot * spacing)
                    if date > horizon { break }
                    updates.insert(date)
                }
            }
            let entries = updates.sorted().map { QuotaEntry(date: $0, snapshot: snapshot) }
            completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(spacing))))
        }
    }
}

private struct QuotaView: View {
    let entry: QuotaEntry
    @Environment(\.widgetFamily) private var family
    @Environment(\.widgetRenderingMode) private var renderingMode
    private var colors: WidgetColors { WidgetColors(mode: renderingMode) }

    private var isSmall: Bool { family == .systemSmall }
    private var chinese: Bool { entry.snapshot?.language != "en" }
    private var visibleItems: [QuotaItem] {
        Array((entry.snapshot?.items ?? []).prefix(isSmall ? 1 : 2))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: isSmall ? 8 : 10) {
            HStack {
                Image(systemName: "gauge.with.dots.needle.33percent")
                    .foregroundStyle(colors.accent).widgetAccentable()
                Text(chinese ? "额度监控" : "Quota Monitor")
                    .font(isSmall ? .subheadline.weight(.semibold) : .headline)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Spacer(minLength: 0)
            }
            if visibleItems.isEmpty {
                Spacer(minLength: 0)
                Text(chinese ? "打开 Widgitron 添加额度来源" : "Open Widgitron to add a quota source")
                    .font(.caption)
                    .foregroundStyle(colors.secondary)
                Spacer(minLength: 0)
            } else {
                HStack(alignment: .top, spacing: 14) {
                    ForEach(visibleItems.indices, id: \.self) { index in
                        quotaRow(visibleItems[index])
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .padding(isSmall ? 12 : 14)
        .containerBackground(for: .widget) { Color(nsColor: .windowBackgroundColor) }
        .widgetURL(quotaAppURL)
    }

    private func quotaRow(_ item: QuotaItem) -> some View {
        let bars = item.visibleBars
        let reset = item.cardReset
        return VStack(alignment: .leading, spacing: isSmall ? 4 : 5) {
            HStack(spacing: 6) {
                Text(item.name)
                    .font((isSmall ? Font.caption : Font.subheadline).weight(.semibold))
                    .lineLimit(1).layoutPriority(1)
                if !isSmall, entry.snapshot?.showPlanType == true,
                   let plan = item.planType, !plan.isEmpty {
                    Text(plan.uppercased()).font(.caption2).foregroundStyle(colors.secondary).lineLimit(1)
                }
                Spacer(minLength: 4)
                if bars.isEmpty, let amount = item.amount {
                    Text(amount)
                        .font((isSmall ? Font.caption : Font.subheadline).weight(.bold))
                        .foregroundStyle(colors.accent).widgetAccentable()
                        .lineLimit(1)
                }
                quotaRefreshLink(item.lastUpdate)
            }
            if !bars.isEmpty {
                ForEach(bars.indices, id: \.self) { index in
                    let bar = bars[index]
                    let percent = min(max(bar.value, 0), 100)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 4) {
                            Text(usageLabel(bar.name)).font(.caption2).lineLimit(1).layoutPriority(1)
                            Spacer(minLength: 0)
                            if let barReset = bar.reset, barReset != reset {
                                resetLabel(barReset)
                            }
                            Text("\(Int(percent.rounded()))%")
                                .font(.caption2.weight(.bold)).monospacedDigit().fixedSize()
                                .foregroundStyle(colors.accent).widgetAccentable()
                        }
                        ProgressView(value: percent / 100).controlSize(.small).tint(colors.progress).widgetAccentable()
                    }
                }
            } else if let progress = item.progress {
                ProgressView(value: progress).controlSize(.small).tint(colors.progress).widgetAccentable()
            } else if let error = item.errorMessage, !error.isEmpty {
                Text(error).font(.caption2).foregroundStyle(colors.secondary).lineLimit(1)
            } else {
                Text(chinese ? "等待更新" : "Waiting for update")
                    .font(.caption2).foregroundStyle(colors.secondary)
            }
            if reset != nil || (bars.isEmpty && item.primaryName != nil) {
                HStack(spacing: 4) {
                    if bars.isEmpty, let label = item.primaryName {
                        Text(usageLabel(label)).lineLimit(1)
                    }
                    if let reset, !reset.isEmpty {
                        Spacer(minLength: 0)
                        resetLabel(reset)
                    }
                }
                .font(.caption2)
                .foregroundStyle(colors.secondary)
                .lineLimit(1)
            }
        }
    }

    private func usageLabel(_ label: String) -> String {
        guard chinese else { return label }
        switch label {
        case "5h Usage": return "5 小时用量"
        case "7d Usage": return "7 天用量"
        default: return label
        }
    }

    private func quotaRefreshLink(_ updated: String?) -> some View {
        let fullTime = updated ?? (chinese ? "从未更新" : "Never")
        let lastUpdate = chinese ? "上次更新：\(fullTime)" : "Last Update: \(fullTime)"
        let action = chinese ? "打开 Widgitron 并刷新额度" : "Open Widgitron and refresh quotas"
        return Link(destination: quotaRefreshURL) {
            HStack(spacing: 3) {
                Image(systemName: "clock")
                if let updated { Text(QuotaTime.shortUpdate(updated)) }
            }
            .font(.caption2).monospacedDigit().foregroundStyle(colors.secondary).fixedSize()
        }
        .help("\(lastUpdate)\n\(action)").accessibilityLabel(action).accessibilityHint(lastUpdate)
    }

    private func resetLabel(_ reset: String) -> some View {
        let tooltip = chinese ? "重置：\(reset)" : "Reset: \(reset)"
        return Text(QuotaTime.countdown(reset, at: entry.date, chinese: chinese))
            .font(.caption2).monospacedDigit().foregroundStyle(colors.secondary)
            .lineLimit(1).minimumScaleFactor(0.8).help(tooltip).accessibilityHint(tooltip)
    }
}

private struct QuotaWidget: Widget {
    private var galleryChinese: Bool { Locale.preferredLanguages.first?.hasPrefix("zh") == true }

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: quotaWidgetKind, provider: QuotaProvider()) { entry in
            QuotaView(entry: entry)
        }
        .configurationDisplayName(galleryChinese ? "Widgitron · 额度监控" : "Widgitron · Quota Monitor")
        .description(galleryChinese ? "在通知中心查看额度使用情况" : "View quota usage in Notification Center")
        .supportedFamilies([.systemSmall, .systemMedium])
        .contentMarginsDisabled()
        .containerBackgroundRemovable(true)
    }
}

private struct GpuSnapshot: Decodable {
    let language: String
    let servers: [GpuServer]
}

private struct GpuServer: Decodable {
    let host: String
    let isOnline: Bool
    let gpuCount: Int
    let averageUtil: Double?
    let cpuPercent: Double?
    let memoryUsedBytes: UInt64?
    let memoryTotalBytes: UInt64?

    enum CodingKeys: String, CodingKey {
        case host
        case isOnline = "is_online"
        case gpuCount = "gpu_count"
        case averageUtil = "average_util"
        case cpuPercent = "cpu_percent"
        case memoryUsedBytes = "memory_used_bytes"
        case memoryTotalBytes = "memory_total_bytes"
    }
}

private struct GpuEntry: TimelineEntry {
    let date: Date
    let snapshot: GpuSnapshot?
}

private struct GpuProvider: TimelineProvider {
    func placeholder(in context: Context) -> GpuEntry {
        GpuEntry(date: .now, snapshot: GpuSnapshot(language: "zh-CN", servers: [
            GpuServer(host: "GPU Server", isOnline: true, gpuCount: 4, averageUtil: 42,
                      cpuPercent: 28, memoryUsedBytes: 8_589_934_592, memoryTotalBytes: 17_179_869_184)
        ]))
    }

    func getSnapshot(in context: Context, completion: @escaping (GpuEntry) -> Void) {
        if context.isPreview { completion(placeholder(in: context)); return }
        loadSnapshot("gpu-snapshot.json", as: GpuSnapshot.self) { snapshot in
            completion(GpuEntry(date: .now, snapshot: snapshot))
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<GpuEntry>) -> Void) {
        loadSnapshot("gpu-snapshot.json", as: GpuSnapshot.self) { snapshot in
            let entry = GpuEntry(date: .now, snapshot: snapshot)
            completion(Timeline(entries: [entry], policy: .after(entry.date.addingTimeInterval(5 * 60))))
        }
    }
}

private struct GpuView: View {
    let entry: GpuEntry
    @Environment(\.widgetFamily) private var family
    @Environment(\.widgetRenderingMode) private var renderingMode
    private var colors: WidgetColors { WidgetColors(mode: renderingMode) }

    private var chinese: Bool { entry.snapshot?.language != "en" }
    private var servers: [GpuServer] { entry.snapshot?.servers ?? [] }
    private var online: [GpuServer] { servers.filter(\.isOnline) }

    private func gpuUsageLabel(_ server: GpuServer) -> String? {
        guard server.isOnline, server.gpuCount > 0 else { return nil }
        let value = server.averageUtil.map { "\(Int(min(max($0, 0), 100).rounded()))%" } ?? "—"
        return chinese ? "GPU 平均使用率 \(value)" : "GPU avg usage \(value)"
    }

    private func resourceLabel(_ server: GpuServer) -> String? {
        guard server.isOnline else { return nil }
        var parts: [String] = []
        if let cpu = server.cpuPercent {
            parts.append("CPU \(Int(cpu.rounded()))%")
        }
        if let used = server.memoryUsedBytes, let total = server.memoryTotalBytes, total > 0 {
            parts.append(String(format: "RAM %.1f/%.0f GB", Double(used) / 1_073_741_824,
                                Double(total) / 1_073_741_824))
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: family == .systemSmall ? 8 : 6) {
            HStack(spacing: 5) {
                Image(systemName: "cpu").foregroundStyle(colors.accent).widgetAccentable()
                Text(chinese ? "GPU 监控" : "GPU Monitor")
                    .font(family == .systemSmall ? .subheadline.weight(.semibold) : .headline)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            if servers.isEmpty {
                Spacer(minLength: 0)
                Text(chinese ? "打开 Widgitron 添加服务器" : "Open Widgitron to add a server")
                    .font(.caption).foregroundStyle(colors.secondary)
                Spacer(minLength: 0)
            } else if family == .systemSmall {
                Spacer(minLength: 0)
                Text("\(online.reduce(0) { $0 + $1.gpuCount }) GPU")
                    .font(.title2.weight(.bold)).foregroundStyle(colors.accent).widgetAccentable()
                Text(chinese ? "\(online.count)/\(servers.count) 台服务器在线" : "\(online.count)/\(servers.count) servers online")
                    .font(.caption2).foregroundStyle(colors.secondary).lineLimit(1)
                if servers.count == 1, let label = resourceLabel(servers[0]) {
                    Text(label).font(.caption2).foregroundStyle(colors.secondary).lineLimit(1)
                }
                Spacer(minLength: 0)
            } else {
                ForEach(servers.prefix(3), id: \.host) { server in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(server.host).font(.caption.weight(.semibold)).lineLimit(1)
                            Spacer(minLength: 4)
                            Text(server.isOnline
                                 ? (server.gpuCount > 0 ? "\(server.gpuCount) GPU" : (chinese ? "无 GPU" : "No GPU"))
                                 : (chinese ? "离线" : "Offline"))
                                .font(.caption2).foregroundStyle(server.isOnline ? Color.primary : colors.secondary)
                        }
                        if let usage = gpuUsageLabel(server), let resources = resourceLabel(server) {
                            HStack(spacing: 4) {
                                Text(usage).foregroundStyle(colors.accent).widgetAccentable()
                                Text("· \(resources)").foregroundStyle(colors.secondary)
                                    .minimumScaleFactor(0.8)
                            }
                            .font(.caption2).lineLimit(1)
                        } else if let label = gpuUsageLabel(server) ?? resourceLabel(server) {
                            Text(label).font(.caption2).foregroundStyle(colors.secondary).lineLimit(1)
                        }
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .padding(family == .systemSmall ? 12 : 14)
        .containerBackground(for: .widget) { Color(nsColor: .windowBackgroundColor) }
        .widgetURL(gpuAppURL)
    }
}

private struct GpuWidget: Widget {
    private var galleryChinese: Bool { Locale.preferredLanguages.first?.hasPrefix("zh") == true }

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: gpuWidgetKind, provider: GpuProvider()) { entry in
            GpuView(entry: entry)
        }
        .configurationDisplayName(galleryChinese ? "Widgitron · GPU 监控" : "Widgitron · GPU Monitor")
        .description(galleryChinese ? "查看服务器与 GPU 状态" : "View server and GPU status")
        .supportedFamilies([.systemSmall, .systemMedium])
        .contentMarginsDisabled()
        .containerBackgroundRemovable(true)
    }
}

private struct DeadlineSnapshot: Decodable {
    let language: String
    let hasSelections: Bool
    let items: [DeadlineItem]

    enum CodingKeys: String, CodingKey {
        case language, items
        case hasSelections = "has_selections"
    }
}

private func deadlineDate(_ value: String?) -> Date? {
    guard let value else { return nil }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: value) { return date }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: value)
}

private struct DeadlineMilestone: Decodable {
    let label: String
    let stage: String
    let deadlineUTC: String?
    let note: String?
    enum CodingKeys: String, CodingKey {
        case label, stage, note
        case deadlineUTC = "deadline_utc"
    }
    var date: Date? { deadlineDate(deadlineUTC) }
}

private struct DeadlineItem: Decodable {
    let title: String
    let year: String
    let deadlineUTC: String
    let deadlineStage: String?
    let deadlineNote: String?
    let deadlineLabel: String?
    let timeline: [DeadlineMilestone]?

    enum CodingKeys: String, CodingKey {
        case title, year, timeline
        case deadlineUTC = "deadline_utc"
        case deadlineStage = "deadline_stage"
        case deadlineNote = "deadline_note"
        case deadlineLabel = "deadline_label"
    }
    var date: Date? { deadlineDate(deadlineUTC) }

    func upcoming(at now: Date) -> DeadlineItem? {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        guard let timeline, !timeline.isEmpty else {
            return date.map { $0 > now ? self : nil } ?? nil
        }
        let next = timeline.filter { $0.date.map { $0 > now } ?? false }
            .min { ($0.date ?? .distantFuture) < ($1.date ?? .distantFuture) }
            ?? ((Int(year) ?? 0) >= calendar.component(.year, from: now)
                ? timeline.first { $0.deadlineUTC == nil } : nil)
        guard let next else { return nil }
        return DeadlineItem(title: title, year: year, deadlineUTC: next.deadlineUTC ?? "",
                            deadlineStage: next.stage, deadlineNote: next.note,
                            deadlineLabel: next.label, timeline: timeline)
    }
}

private struct DeadlineEntry: TimelineEntry {
    let date: Date
    let snapshot: DeadlineSnapshot?
}

private struct DeadlineProvider: TimelineProvider {
    func placeholder(in context: Context) -> DeadlineEntry {
        let date = Calendar.current.date(byAdding: .day, value: 5, to: .now) ?? .now
        let formatter = ISO8601DateFormatter()
        return DeadlineEntry(date: .now, snapshot: DeadlineSnapshot(
            language: "zh-CN", hasSelections: true,
            items: [DeadlineItem(title: "NeurIPS", year: "2026", deadlineUTC: formatter.string(from: date),
                                 deadlineStage: "submission", deadlineNote: nil, deadlineLabel: "Paper submission", timeline: nil)]))
    }

    func getSnapshot(in context: Context, completion: @escaping (DeadlineEntry) -> Void) {
        if context.isPreview { completion(placeholder(in: context)); return }
        loadSnapshot("deadline-snapshot.json", as: DeadlineSnapshot.self) { snapshot in
            completion(DeadlineEntry(date: .now, snapshot: snapshot))
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<DeadlineEntry>) -> Void) {
        loadSnapshot("deadline-snapshot.json", as: DeadlineSnapshot.self) { snapshot in
            let now = Date.now
            // Schedule stage boundaries as WidgetKit entries, so rollover does
            // not depend on the host app running or a network refresh completing.
            let boundaries = Set((snapshot?.items ?? []).flatMap { item in
                item.timeline?.compactMap { $0.date } ?? [item.date].compactMap { $0 }
            }.filter { $0 > now && $0 < now.addingTimeInterval(86_400) })
            let dates = [now] + boundaries.sorted().prefix(40).map { $0.addingTimeInterval(1) }
            let entries = dates.map { DeadlineEntry(date: $0, snapshot: snapshot) }
            completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(5 * 60))))
        }
    }

}

private struct DeadlineView: View {
    let entry: DeadlineEntry
    @Environment(\.widgetFamily) private var family
    @Environment(\.widgetRenderingMode) private var renderingMode
    private var colors: WidgetColors { WidgetColors(mode: renderingMode) }

    private var chinese: Bool { entry.snapshot?.language != "en" }
    private var allItems: [DeadlineItem] {
        (entry.snapshot?.items ?? []).compactMap { $0.upcoming(at: entry.date) }
            .sorted { ($0.date ?? .distantFuture) < ($1.date ?? .distantFuture) }
    }
    private var capacity: Int { family == .systemSmall ? 2 : 3 }
    private var items: [DeadlineItem] {
        Array(allItems.prefix(capacity))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 5) {
                Image(systemName: "calendar.badge.clock").foregroundStyle(colors.accent).widgetAccentable()
                Text(chinese ? "会议截止" : "Conference DDL")
                    .font(family == .systemSmall ? .subheadline.weight(.semibold) : .headline)
                    .lineLimit(1).minimumScaleFactor(0.8)
                Spacer(minLength: 0)
                if allItems.count > items.count {
                    Text("+\(allItems.count - items.count)")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(colors.secondary)
                        .accessibilityLabel(chinese
                            ? "还有 \(allItems.count - items.count) 场会议"
                            : "\(allItems.count - items.count) more conferences")
                }
            }
            if items.isEmpty {
                Spacer(minLength: 0)
                Text(entry.snapshot?.hasSelections == true
                     ? (chinese ? "已关注会议暂无即将截止日期" : "No upcoming followed deadlines")
                     : (chinese ? "打开 Widgitron 关注会议" : "Open Widgitron to follow conferences"))
                    .font(.caption).foregroundStyle(colors.secondary)
                Spacer(minLength: 0)
            } else {
                ForEach(items.indices, id: \.self) { index in
                    deadlineRow(items[index], prominent: family == .systemSmall && index == 0)
                }
                Spacer(minLength: 0)
            }
        }
        .padding(family == .systemSmall ? 12 : 14)
        .containerBackground(for: .widget) { Color(nsColor: .windowBackgroundColor) }
        .widgetURL(deadlineAppURL)
    }

    private func deadlineRow(_ item: DeadlineItem, prominent: Bool) -> some View {
        VStack(alignment: .leading, spacing: prominent ? 4 : 2) {
            HStack(spacing: 5) {
                Text("\(item.title) \(item.year)")
                    .font(.caption.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.8)
                Spacer(minLength: 0)
                if let date = item.date {
                    Text(remaining(date))
                        .font(.caption2.weight(.bold)).foregroundStyle(colors.accent).widgetAccentable().lineLimit(1)
                }
            }
            if family == .systemSmall {
                stageCaption(item)
                if let date = item.date {
                    Text(DateFormatter.localizedString(from: date, dateStyle: .short, timeStyle: .short))
                        .font(.caption2).foregroundStyle(colors.secondary).lineLimit(1).minimumScaleFactor(0.8)
                } else {
                    Text("TBD").font(.caption2).foregroundStyle(colors.secondary)
                }
            } else {
                // Keep three medium rows within the widget's fixed height.
                HStack(spacing: 6) {
                    stageCaption(item)
                    Spacer(minLength: 0)
                    if let date = item.date {
                        Text(DateFormatter.localizedString(from: date, dateStyle: .short, timeStyle: .short))
                            .font(.caption2).foregroundStyle(colors.secondary).lineLimit(1).minimumScaleFactor(0.8)
                    } else {
                        Text("TBD").font(.caption2).foregroundStyle(colors.secondary)
                    }
                }
            }
        }
    }

    private func stageCaption(_ item: DeadlineItem) -> some View {
        Text(stageLabel(item))
            .font(.system(size: 10, weight: item.deadlineStage == "arr_commitment" ? .semibold : .regular))
            .foregroundStyle(item.deadlineStage == "arr_commitment" ? colors.warning : colors.secondary)
            .lineLimit(1).minimumScaleFactor(0.7)
            .accessibilityLabel(item.deadlineNote ?? stageLabel(item))
    }

    private func stageLabel(_ item: DeadlineItem) -> String {
        // Stage copy remains English even when the surrounding interface is Chinese.
        if let label = item.deadlineLabel, !label.isEmpty { return label }
        switch item.deadlineStage {
        case "abstract_submission": return "Abstract submission"
        case "submission": return "Paper submission"
        case "full_paper_submission": return "Full paper submission"
        case "arr_commitment": return "ARR commitment · reviewed papers only"
        case "arr_submission": return "ARR submission"
        case "rebuttal": return "Rebuttal / author response"
        case "decision": return "Decision notification"
        default: return item.deadlineNote ?? "Deadline type not specified"
        }
    }

    private func remaining(_ date: Date) -> String {
        let seconds = date.timeIntervalSince(entry.date)
        if seconds <= 0 { return chinese ? "已截止" : "Passed" }
        if seconds >= 86_400 {
            let days = Int(ceil(seconds / 86_400))
            return chinese ? "剩 \(days) 天" : "\(days)d left"
        }
        let hours = max(1, Int(ceil(seconds / 3_600)))
        return chinese ? "剩 \(hours) 小时" : "\(hours)h left"
    }
}

private struct DeadlineWidget: Widget {
    private var galleryChinese: Bool { Locale.preferredLanguages.first?.hasPrefix("zh") == true }

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: deadlineWidgetKind, provider: DeadlineProvider()) { entry in
            DeadlineView(entry: entry)
        }
        .configurationDisplayName(galleryChinese ? "Widgitron · 会议截止" : "Widgitron · Conference DDL")
        .description(galleryChinese ? "显示已关注会议的最近截止节点" : "Show the next deadline for followed conferences")
        .supportedFamilies([.systemSmall, .systemMedium])
        .contentMarginsDisabled()
        .containerBackgroundRemovable(true)
    }
}

@main
struct WidgitronWidgets: WidgetBundle {
    var body: some Widget {
        QuotaWidget()
        GpuWidget()
        DeadlineWidget()
    }
}
