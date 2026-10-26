using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using NLog;

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

        // Returns TypeName -> minutes for every usable line in the file.
        public static Dictionary<string, int> Load(string appDataFolder, IList<ScheduledTask> tasks, Logger logger)
        {
            var result = new Dictionary<string, int>(StringComparer.Ordinal);
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

            return result;
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
