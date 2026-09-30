import Foundation
import SwiftUI
import WidgetKit

private let appGroup = Bundle.main.object(forInfoDictionaryKey: "WidgitronAppGroupIdentifier") as? String
    ?? "group.com.evan.widgitron"
private let quotaWidgetKind = "com.evan.widgitron.quota"
private let gpuWidgetKind = "com.evan.widgitron.gpu"
private let deadlineWidgetKind = "com.evan.widgitron.deadlines"
private let openAppURL = URL(string: "widgitron://open")
private let snapshotBaseURL = URL(string: "http://127.0.0.1:42837")!

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

private struct QuotaItem: Decodable {
    let name: String
    let provider: String
    let currentValue: Double?
    let maxQuota: Double?
    let unit: String?
    let primaryName: String?
    let primaryReset: String?
    let lastUpdate: String?
    let planType: String?
    let errorMessage: String?

    enum CodingKeys: String, CodingKey {
        case name, provider, unit
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

    func usageLabel(chinese: Bool) -> String? {
        guard let primaryName, !primaryName.isEmpty else { return nil }
        if chinese && primaryName == "7d Usage" { return "7 天用量" }
        return primaryName
    }
}

private struct QuotaEntry: TimelineEntry {
    let date: Date
    let snapshot: QuotaSnapshot?
}

private struct QuotaProvider: TimelineProvider {
    func placeholder(in context: Context) -> QuotaEntry {
        QuotaEntry(date: .now, snapshot: QuotaSnapshot(
            language: "zh-CN", showPlanType: true,
            items: [QuotaItem(name: "Codex", provider: "codex", currentValue: 55,
                              maxQuota: 100, unit: "%", primaryName: "7d Usage",
                              primaryReset: nil, lastUpdate: nil,
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
            let entry = QuotaEntry(date: .now, snapshot: snapshot)
            completion(Timeline(entries: [entry], policy: .after(entry.date.addingTimeInterval(5 * 60))))
        }
    }
}

private struct QuotaView: View {
    let entry: QuotaEntry
    @Environment(\.widgetFamily) private var family

    private var isSmall: Bool { family == .systemSmall }
    private var chinese: Bool { entry.snapshot?.language != "en" }
    private var visibleItems: [QuotaItem] {
        Array((entry.snapshot?.items ?? []).prefix(isSmall ? 1 : 2))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: isSmall ? 8 : 10) {
            HStack {
                Image(systemName: "gauge.with.dots.needle.33percent")
                    .foregroundStyle(.tint)
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
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
            } else {
                ForEach(visibleItems.indices, id: \.self) { index in
                    quotaRow(visibleItems[index])
                }
                Spacer(minLength: 0)
            }
        }
        .padding(isSmall ? 12 : 14)
        .containerBackground(for: .widget) { Color(nsColor: .windowBackgroundColor) }
        .widgetURL(openAppURL)
    }

    private func quotaRow(_ item: QuotaItem) -> some View {
        VStack(alignment: .leading, spacing: isSmall ? 4 : 5) {
            HStack(spacing: 6) {
                Text(item.name)
                    .font((isSmall ? Font.caption : Font.subheadline).weight(.semibold))
                    .lineLimit(1)
                if !isSmall, entry.snapshot?.showPlanType == true,
                   let plan = item.planType, !plan.isEmpty {
                    Text(plan.uppercased()).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 4)
                if let amount = item.amount {
                    Text(amount)
                        .font((isSmall ? Font.caption : Font.subheadline).weight(.bold))
                        .foregroundStyle(.tint)
                        .lineLimit(1)
                }
            }
            if let progress = item.progress {
                ProgressView(value: progress).tint(.mint)
            } else if let error = item.errorMessage, !error.isEmpty {
                Text(error).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            } else {
                Text(chinese ? "等待更新" : "Waiting for update")
                    .font(.caption2).foregroundStyle(.secondary)
            }
            if let label = item.usageLabel(chinese: chinese) {
                HStack(spacing: 4) {
                    Text(label)
                    if !isSmall, let reset = item.primaryReset, !reset.isEmpty {
                        Text("(\(reset))")
                    }
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
        }
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
                Image(systemName: "cpu").foregroundStyle(.tint)
                Text(chinese ? "GPU 监控" : "GPU Monitor")
                    .font(family == .systemSmall ? .subheadline.weight(.semibold) : .headline)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            if servers.isEmpty {
                Spacer(minLength: 0)
                Text(chinese ? "打开 Widgitron 添加服务器" : "Open Widgitron to add a server")
                    .font(.caption).foregroundStyle(.secondary)
                Spacer(minLength: 0)
            } else if family == .systemSmall {
                Spacer(minLength: 0)
                Text("\(online.reduce(0) { $0 + $1.gpuCount }) GPU")
                    .font(.title2.weight(.bold))
                Text(chinese ? "\(online.count)/\(servers.count) 台服务器在线" : "\(online.count)/\(servers.count) servers online")
                    .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                if servers.count == 1, let label = resourceLabel(servers[0]) {
                    Text(label).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
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
                                .font(.caption2).foregroundStyle(server.isOnline ? .primary : .secondary)
                        }
                        if let usage = gpuUsageLabel(server), let resources = resourceLabel(server) {
                            HStack(spacing: 4) {
                                Text(usage).foregroundStyle(.primary)
                                Text("· \(resources)").foregroundStyle(.secondary)
                                    .minimumScaleFactor(0.8)
                            }
                            .font(.caption2).lineLimit(1)
                        } else if let label = gpuUsageLabel(server) ?? resourceLabel(server) {
                            Text(label).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .padding(family == .systemSmall ? 12 : 14)
        .containerBackground(for: .widget) { Color(nsColor: .windowBackgroundColor) }
        .widgetURL(openAppURL)
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

private struct DeadlineItem: Decodable {
    let title: String
    let year: String
    let deadlineUTC: String

    enum CodingKeys: String, CodingKey {
        case title, year
        case deadlineUTC = "deadline_utc"
    }

    var date: Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: deadlineUTC) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: deadlineUTC)
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
            items: [DeadlineItem(title: "NeurIPS", year: "2026", deadlineUTC: formatter.string(from: date))]))
    }

    func getSnapshot(in context: Context, completion: @escaping (DeadlineEntry) -> Void) {
        if context.isPreview { completion(placeholder(in: context)); return }
        loadSnapshot("deadline-snapshot.json", as: DeadlineSnapshot.self) { snapshot in
            completion(DeadlineEntry(date: .now, snapshot: snapshot))
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<DeadlineEntry>) -> Void) {
        loadSnapshot("deadline-snapshot.json", as: DeadlineSnapshot.self) { snapshot in
            let entry = DeadlineEntry(date: .now, snapshot: snapshot)
            completion(Timeline(entries: [entry], policy: .after(entry.date.addingTimeInterval(5 * 60))))
        }
    }
}

private struct DeadlineView: View {
    let entry: DeadlineEntry
    @Environment(\.widgetFamily) private var family

    private var chinese: Bool { entry.snapshot?.language != "en" }
    private var allItems: [DeadlineItem] { entry.snapshot?.items ?? [] }
    private var capacity: Int { family == .systemSmall ? 2 : 3 }
    private var items: [DeadlineItem] {
        Array(allItems.prefix(capacity))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 5) {
                Image(systemName: "calendar.badge.clock").foregroundStyle(.tint)
                Text(chinese ? "论文截止日期" : "Deadlines")
                    .font(family == .systemSmall ? .subheadline.weight(.semibold) : .headline)
                    .lineLimit(1).minimumScaleFactor(0.8)
                Spacer(minLength: 0)
                if allItems.count > items.count {
                    Text("+\(allItems.count - items.count)")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .accessibilityLabel(chinese
                            ? "还有 \(allItems.count - items.count) 场会议"
                            : "\(allItems.count - items.count) more conferences")
                }
            }
            if items.isEmpty {
                Spacer(minLength: 0)
                Text(entry.snapshot?.hasSelections == true
                     ? (chinese ? "已提醒会议暂无即将截止日期" : "No upcoming selected deadlines")
                     : (chinese ? "打开 Widgitron 选择提醒会议" : "Open Widgitron to choose conferences"))
                    .font(.caption).foregroundStyle(.secondary)
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
        .widgetURL(openAppURL)
    }

    private func deadlineRow(_ item: DeadlineItem, prominent: Bool) -> some View {
        VStack(alignment: .leading, spacing: prominent ? 4 : 2) {
            HStack(spacing: 5) {
                Text("\(item.title) \(item.year)")
                    .font(.caption.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.8)
                Spacer(minLength: 0)
                if !prominent, let date = item.date {
                    Text(remaining(date))
                        .font(.caption2.weight(.bold)).foregroundStyle(.tint).lineLimit(1)
                }
            }
            if let date = item.date {
                if prominent {
                    Text(remaining(date)).font(.title3.weight(.bold)).foregroundStyle(.tint)
                }
                Text(DateFormatter.localizedString(from: date, dateStyle: .short, timeStyle: .short))
                    .font(.caption2).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.8)
            }
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
        .configurationDisplayName(galleryChinese ? "Widgitron · 论文截止日期" : "Widgitron · Paper Deadlines")
        .description(galleryChinese ? "只显示已选择提醒的会议" : "Show only selected conferences")
        .supportedFamilies([.systemSmall, .systemMedium])
        .contentMarginsDisabled()
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
