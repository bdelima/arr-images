using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using NLog;
using NzbDrone.Core.Exceptions;
using NzbDrone.Core.Messaging.Commands;

namespace NzbDrone.Core.Jobs
{
    // Lets an operator override the interval of ANY scheduled task from a plain properties file
    // (scheduled-tasks.properties, in the app data folder, which is /config in the container images).
    //
    // Format, one entry per line:
    //     RefreshMovie=10080
    //     NzbDrone.Core.Housekeeping.HousekeepingCommand = 0
    //     # comment      ! comment      (blank lines are ignored)
    //
    // Key: the task's short name (its command type name without the trailing "Command"), or its full type
    //      name; matching is case-insensitive.
    // Value: minutes, a whole number >= 0. 0 disables that task's own schedule (it can still be run by hand,
    //      or by an API call).
    //
    // Scheduled requests (API calls that ask to run a task as the app's own timer would):
    //     ScheduledLookback.RefreshMovie=1445
    // Only for tasks that ask the metadata server what changed since the last run (Radarr RefreshMovie, Lidarr
    // RefreshArtist). Minutes of "changed since" history to use for such a request; a whole number >= 1. Without
    // it the window is the task's effective interval plus 5 minutes. A task whose effective interval is 0 refuses
    // scheduled requests. See PrepareScheduledRequest.
    //
    // Absent file: nothing changes, upstream defaults apply. A line that cannot be used (no '=', an unknown
    // task, a value that is not a whole number >= 0) is logged as a warning and ignored; the rest of the file
    // still applies. The file is read once, when the application starts.
    //
    // Added by bdelima/arr-images; not part of upstream.
    internal static class ScheduledTaskIntervalOverrides
    {
        public const string FileName = "scheduled-tasks.properties";

        public static string ShortName(string typeName)
        {
            var name = typeName ?? string.Empty;
            var dot = name.LastIndexOf('.');

            if (dot >= 0)
            {
                name = name.Substring(dot + 1);
            }

            const string suffix = "Command";

            if (name.Length > suffix.Length && name.EndsWith(suffix, StringComparison.Ordinal))
            {
                name = name.Substring(0, name.Length - suffix.Length);
            }

            return name;
        }

        public const string LookbackPrefix = "ScheduledLookback.";

        // Upstream ignores a start time older than this and falls back to its per-item rules.
        private const int MaxChangedListMinutes = 14 * 24 * 60;
        private const int WindowMarginMinutes = 5;

        // Short names of the tasks that use a "changed since LastStartTime" list.
        private static readonly string[] ChangedListTasks = { "RefreshMovie", "RefreshArtist" };

        private static readonly Dictionary<string, int> NoValues = new Dictionary<string, int>();

        // Replaced whole (never mutated), so readers on other threads always see a consistent snapshot.
        private static volatile Dictionary<string, int> _lookbacks = NoValues;
        private static volatile Dictionary<string, int> _intervals = NoValues;

        private static bool UsesChangedList(string typeName)
        {
            return ChangedListTasks.Contains(ShortName(typeName), StringComparer.OrdinalIgnoreCase);
        }

        // Returns TypeName -> minutes for every usable line in the file.
        public static Dictionary<string, int> Load(string appDataFolder, IList<ScheduledTask> tasks, Logger logger)
        {
            var result = new Dictionary<string, int>(StringComparer.Ordinal);
            var lookbacks = new Dictionary<string, int>(StringComparer.Ordinal);
            var path = Path.Combine(appDataFolder ?? string.Empty, FileName);

            if (!File.Exists(path))
            {
                logger.Info("No {0} in {1}: scheduled task intervals are the upstream defaults", FileName, appDataFolder);
                return result;
            }

            string[] lines;

            try
            {
                lines = File.ReadAllLines(path);
            }
            catch (Exception ex)
            {
                logger.Warn(ex, "Could not read {0}; scheduled task intervals are the upstream defaults", path);
                return result;
            }

            var known = string.Join(", ", tasks.Select(t => ShortName(t.TypeName)).OrderBy(n => n, StringComparer.OrdinalIgnoreCase));

            for (var i = 0; i < lines.Length; i++)
            {
                var line = lines[i].Trim();

                if (line.Length == 0 || line[0] == '#' || line[0] == '!')
                {
                    continue;
                }

                var separator = line.IndexOf('=');

                if (separator <= 0)
                {
                    logger.Warn("{0} line {1} ignored: expected Name=minutes", FileName, i + 1);
                    continue;
                }

                var key = line.Substring(0, separator).Trim();
                var value = line.Substring(separator + 1).Trim();

                if (key.StartsWith(LookbackPrefix, StringComparison.OrdinalIgnoreCase))
                {
                    ParseLookback(key.Substring(LookbackPrefix.Length).Trim(), value, i + 1, tasks, known, lookbacks, logger);
                    continue;
                }

                var task = tasks.FirstOrDefault(t =>
                    string.Equals(ShortName(t.TypeName), key, StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(t.TypeName, key, StringComparison.OrdinalIgnoreCase));

                if (task == null)
                {
                    logger.Warn("{0} line {1} ignored: unknown task '{2}'. Known tasks: {3}", FileName, i + 1, key, known);
                    continue;
                }

                if (!int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var minutes))
                {
                    logger.Warn("{0} line {1} ignored: '{2}' is not a whole number of minutes >= 0 (task {3})", FileName, i + 1, value, ShortName(task.TypeName));
                    continue;
                }

                if (result.ContainsKey(task.TypeName))
                {
                    logger.Warn("{0} line {1}: task {2} is set more than once; the last value wins", FileName, i + 1, ShortName(task.TypeName));
                }

                result[task.TypeName] = minutes;
            }

            _lookbacks = lookbacks;

            return result;
        }

        private static void ParseLookback(string name, string value, int lineNumber, IList<ScheduledTask> tasks, string known, Dictionary<string, int> lookbacks, Logger logger)
        {
            var task = tasks.FirstOrDefault(t =>
                string.Equals(ShortName(t.TypeName), name, StringComparison.OrdinalIgnoreCase) ||
                string.Equals(t.TypeName, name, StringComparison.OrdinalIgnoreCase));

            if (task == null)
            {
                logger.Warn("{0} line {1} ignored: unknown task '{2}'. Known tasks: {3}", FileName, lineNumber, name, known);
                return;
            }

            if (!UsesChangedList(task.TypeName))
            {
                logger.Warn("{0} line {1} ignored: {2} does not use a changed list, so a look-back means nothing for it (only {3} do)", FileName, lineNumber, ShortName(task.TypeName), string.Join(", ", ChangedListTasks));
                return;
            }

            if (!int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var minutes) || minutes < 1)
            {
                logger.Warn("{0} line {1} ignored: '{2}' is not a whole number of minutes >= 1 ({3}{4})", FileName, lineNumber, value, LookbackPrefix, ShortName(task.TypeName));
                return;
            }

            if (minutes > MaxChangedListMinutes)
            {
                logger.Warn("{0}{1}={2} is more than {3} minutes: upstream ignores a start time that old, so the changed list will not be used", LookbackPrefix, ShortName(task.TypeName), minutes, MaxChangedListMinutes);
            }

            lookbacks[task.TypeName] = minutes;
        }

        // Records the effective interval of every task (after the overrides were applied) for scheduled requests.
        public static void Publish(IList<ScheduledTask> tasks, Logger logger)
        {
            var intervals = new Dictionary<string, int>(StringComparer.Ordinal);

            foreach (var task in tasks)
            {
                intervals[task.TypeName] = task.Interval;

                if (UsesChangedList(task.TypeName) && task.Interval > 0 && !_lookbacks.ContainsKey(task.TypeName) &&
                    task.Interval + WindowMarginMinutes > MaxChangedListMinutes)
                {
                    logger.Warn("Scheduled task {0}: interval {1} + {2} is more than {3} minutes, so a scheduled request's changed list will not be used unless {4}{0} is set lower", ShortName(task.TypeName), task.Interval, WindowMarginMinutes, MaxChangedListMinutes, LookbackPrefix);
                }
            }

            _intervals = intervals;
        }

        // Called by CommandQueueManager.Push when an API caller asked for the Scheduled trigger (the app's own
        // timer runs tasks with it, and for some tasks that means a cheaper run than a Manual one).
        //
        // For a task that uses a changed list, LastStartTime is set to "now minus the look-back window" so the
        // run asks the metadata server only what changed in that window. Whatever the caller sent in
        // lastStartTime is replaced. A task whose effective interval is 0 (disabled in the properties file)
        // refuses the request instead of silently falling back to a Manual run.
        public static void PrepareScheduledRequest(Command command, Logger logger)
        {
            var typeName = command.GetType().FullName;
            var name = ShortName(typeName);

            command.LastStartTime = null;

            if (!_intervals.TryGetValue(typeName, out var interval))
            {
                logger.Info("Scheduled request for {0}: trigger honored (no scheduled task of that name, so no look-back)", name);
                return;
            }

            if (interval == 0)
            {
                throw new NzbDroneClientException(HttpStatusCode.BadRequest, "Scheduled run of " + name + " refused: its interval is 0 in " + FileName + ", so its own schedule is disabled");
            }

            if (!UsesChangedList(typeName))
            {
                logger.Info("Scheduled request for {0}: trigger honored (this task has no look-back)", name);
                return;
            }

            int window;
            string source;

            if (_lookbacks.TryGetValue(typeName, out var configured))
            {
                window = configured;
                source = LookbackPrefix + name;
            }
            else
            {
                window = interval + WindowMarginMinutes;
                source = "interval " + interval + " + " + WindowMarginMinutes;
            }

            command.LastStartTime = DateTime.UtcNow.AddMinutes(-window);
            logger.Info("Scheduled request for {0}: trigger honored, look-back {1} minutes ({2})", name, window, source);
        }

        public static void Apply(IList<ScheduledTask> tasks, IDictionary<string, int> overrides, Logger logger)
        {
            foreach (var task in tasks)
            {
                if (!overrides.TryGetValue(task.TypeName, out var minutes))
                {
                    continue;
                }

                logger.Info(
                    "Scheduled task {0}: interval {1} -> {2} minutes ({3})",
                    ShortName(task.TypeName),
                    task.Interval,
                    minutes,
                    minutes == 0 ? "its own schedule is disabled" : "from " + FileName);

                task.Interval = minutes;
            }
        }
    }
}
