using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using NLog;
using NzbDrone.Common.EnvironmentInfo;

namespace NzbDrone.Core.Download
{
    public enum PreImportStatus
    {
        Ready,
        NotReady,
        Failed
    }

    public class PreImportResult
    {
        public PreImportStatus Status { get; set; }
        public string Message { get; set; }
    }

    // Asks an external service whether a completed download may be imported yet, so a pre-import process (stripping
    // unwanted audio/subtitle tracks, say) can finish first. The app does not know what the service checks.
    //
    // Configured by preimport-validator.properties in the app data folder (/config in the container images):
    //     Url=http://validator:8080          (also accepted as PreImportValidator.Url)
    //     # comment      ! comment
    // Without a Url nothing happens: IsConfigured is false and the caller imports exactly as upstream does.
    // The file is read once, when the application starts.
    //
    // Per check: POST {Url}/validate with {"path": "<the download's folder or file>"} and, when the caller has any,
    // {"tags": ["<every tag label on the series/movie>", ...]} -- unfiltered: which of them (if any) names a quality
    // tier is the validator's business (the Tdarr service's TDARR_LIBRARY_MAP), not this app's. 10 second timeout.
    // The answer is read from the JSON body only: {"ready": bool, "failed": bool, "message": string}. "failed": true
    // is PreImportStatus.Failed, "ready": true is Ready, anything else is NotReady. A timeout, an HTTP error status or
    // a body that cannot be read is also NotReady (logged as a warning), never Ready: the import is deferred and the
    // next queue refresh asks again.
    //
    // Added by bdelima/arr-images; not part of upstream.
    public interface IPreImportValidator
    {
        bool IsConfigured { get; }
        PreImportResult Check(string path, IEnumerable<string> tags = null);
    }

    public class PreImportValidator : IPreImportValidator
    {
        public const string FileName = "preimport-validator.properties";

        private static readonly HttpClient Client = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };

        private readonly Logger _logger;
        private readonly string _validateUrl;

        public PreImportValidator(IAppFolderInfo appFolderInfo, Logger logger)
        {
            _logger = logger;

            var url = ReadUrl(Path.Combine(appFolderInfo.AppDataFolder, FileName), logger);

            if (url != null)
            {
                _validateUrl = url.TrimEnd('/') + "/validate";
                logger.Info("PreImportValidator: completed downloads are checked with {0} before import", _validateUrl);
            }
        }

        public bool IsConfigured => _validateUrl != null;

        public PreImportResult Check(string path, IEnumerable<string> tags = null)
        {
            try
            {
                var payload = new Dictionary<string, object> { { "path", path } };

                var tagList = tags?.Where(t => !string.IsNullOrEmpty(t)).ToList();

                if (tagList != null && tagList.Count > 0)
                {
                    payload["tags"] = tagList;
                }

                var body = JsonSerializer.Serialize(payload);

                using (var request = new HttpRequestMessage(HttpMethod.Post, _validateUrl))
                {
                    request.Content = new StringContent(body, Encoding.UTF8, "application/json");

                    using (var response = Client.Send(request))
                    {
                        if (!response.IsSuccessStatusCode)
                        {
                            return NotReady(path, string.Format("HTTP {0}", (int)response.StatusCode));
                        }

                        using (var stream = response.Content.ReadAsStream())
                        using (var json = JsonDocument.Parse(stream))
                        {
                            var root = json.RootElement;
                            var message = root.TryGetProperty("message", out var m) && m.ValueKind == JsonValueKind.String ? m.GetString() : null;

                            if (Flag(root, "failed"))
                            {
                                return new PreImportResult { Status = PreImportStatus.Failed, Message = message ?? "Failed the pre-import check" };
                            }

                            if (Flag(root, "ready"))
                            {
                                return new PreImportResult { Status = PreImportStatus.Ready, Message = message };
                            }

                            _logger.Debug("PreImportValidator: '{0}' is not ready yet ({1})", path, message ?? "no message");

                            return new PreImportResult { Status = PreImportStatus.NotReady, Message = message };
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                return NotReady(path, ex.Message);
            }
        }

        private PreImportResult NotReady(string path, string reason)
        {
            _logger.Warn("PreImportValidator: could not get an answer for '{0}' ({1}); deferring the import", path, reason);

            return new PreImportResult { Status = PreImportStatus.NotReady, Message = reason };
        }

        private static bool Flag(JsonElement root, string name)
        {
            return root.ValueKind == JsonValueKind.Object &&
                   root.TryGetProperty(name, out var value) &&
                   value.ValueKind == JsonValueKind.True;
        }

        private static string ReadUrl(string file, Logger logger)
        {
            if (!File.Exists(file))
            {
                return null;
            }

            string url = null;

            try
            {
                foreach (var raw in File.ReadAllLines(file))
                {
                    var line = raw.Trim();

                    if (line.Length == 0 || line[0] == '#' || line[0] == '!')
                    {
                        continue;
                    }

                    var eq = line.IndexOf('=');

                    if (eq < 0)
                    {
                        logger.Warn("{0}: ignoring '{1}' (expected Key=value)", FileName, line);
                        continue;
                    }

                    var key = line.Substring(0, eq).Trim();
                    var value = line.Substring(eq + 1).Trim();

                    if (key.Equals("Url", StringComparison.OrdinalIgnoreCase) || key.Equals("PreImportValidator.Url", StringComparison.OrdinalIgnoreCase))
                    {
                        url = value;
                    }
                    else
                    {
                        logger.Warn("{0}: ignoring unknown key '{1}'", FileName, key);
                    }
                }
            }
            catch (Exception ex)
            {
                logger.Warn(ex, "{0}: could not be read; no pre-import check is made", FileName);

                return null;
            }

            if (string.IsNullOrEmpty(url))
            {
                return null;
            }

            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            {
                // Still configured: silently importing unchecked because of a typo would defeat the point, so every
                // check fails (and is logged) until the address is fixed.
                logger.Warn("{0}: Url '{1}' is not an http(s) address; every import will be deferred until it is fixed", FileName, url);
            }

            return url;
        }
    }
}
