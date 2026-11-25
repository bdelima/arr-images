using System.Text;
using System.Text.Json;

namespace Sportarr.Api.Services;

public enum PreImportStatus
{
    Ready,
    NotReady,
    Failed
}

/// <param name="Path">Only on a Ready answer, and only when the validator names a different place to import from
/// (the download client's file was renamed or converted): the file, or the folder, to import. Null otherwise.</param>
public sealed record PreImportResult(PreImportStatus Status, string? Message, string? Path = null);

/// <summary>
/// Asks an external service whether a completed download may be imported yet, so a pre-import process
/// (stripping unwanted audio/subtitle tracks, say) can finish first. Sportarr does not know what the
/// service checks.
///
/// Configured by preimport-validator.properties in the data folder (/config in the container image):
///     Url=http://validator:8080          (also accepted as PreImportValidator.Url)
///     # comment      ! comment
/// Without a Url nothing happens: IsConfigured is false and imports go ahead exactly as upstream does.
/// The file is read once, when the validator is first needed.
///
/// Per check: POST {Url}/validate with {"path": "..."} and, when the caller has any, {"tags": ["<every tag label on
/// the league>", ...]} -- unfiltered: which of them (if any) names a quality tier is the validator's business (the Tdarr
/// service's TDARR_LIBRARY_MAP), not Sportarr's. 10 second timeout. The answer is read from the JSON body only:
/// {"ready": bool, "failed": bool, "message": string, "path": string}. "failed": true is Failed, "ready": true is
/// Ready, anything else is NotReady. "path" is optional and read only from a Ready answer: when a Flow renamed or
/// converted the file the download client reported (an mp4 turned into an mkv), it names the file (or the folder) to
/// import instead, in PreImportResult.Path; a missing, empty or non-string "path" leaves it null. The caller must
/// check it with IsReplacementPath before using it. A timeout, an HTTP error status or an unreadable body is also NotReady
/// (logged as a warning), never Ready: the import is deferred and asked again on the next poll.
///
/// Added by bdelima/arr-images; not part of upstream.
/// </summary>
public sealed class PreImportValidator
{
    public const string FileName = "preimport-validator.properties";

    private static readonly HttpClient Client = new() { Timeout = TimeSpan.FromSeconds(10) };

    private readonly ILogger _logger;
    private readonly string? _validateUrl;

    public PreImportValidator(string dataPath, ILogger logger)
    {
        _logger = logger;

        var url = ReadUrl(Path.Combine(dataPath, FileName), logger);
        if (url != null)
        {
            _validateUrl = url.TrimEnd('/') + "/validate";
            logger.LogInformation("PreImportValidator: completed downloads are checked with {Url} before import", _validateUrl);
        }
    }

    public bool IsConfigured => _validateUrl != null;

    public async Task<PreImportResult> CheckAsync(string path, IEnumerable<string>? tags = null)
    {
        try
        {
            var payload = new Dictionary<string, object> { ["path"] = path };

            var tagList = tags?.Where(t => !string.IsNullOrEmpty(t)).ToList();
            if (tagList is { Count: > 0 })
            {
                payload["tags"] = tagList;
            }

            using var request = new HttpRequestMessage(HttpMethod.Post, _validateUrl)
            {
                Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json")
            };
            using var response = await Client.SendAsync(request);

            if (!response.IsSuccessStatusCode)
            {
                return NotReady(path, $"HTTP {(int)response.StatusCode}");
            }

            using var json = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync());
            var root = json.RootElement;
            var message = root.ValueKind == JsonValueKind.Object && root.TryGetProperty("message", out var m) &&
                          m.ValueKind == JsonValueKind.String ? m.GetString() : null;

            if (Flag(root, "failed"))
            {
                return new PreImportResult(PreImportStatus.Failed, message ?? "Failed the pre-import check");
            }

            if (Flag(root, "ready"))
            {
                var replacement = root.TryGetProperty("path", out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;
                return new PreImportResult(PreImportStatus.Ready, message, string.IsNullOrEmpty(replacement) ? null : replacement);
            }

            _logger.LogDebug("PreImportValidator: '{Path}' is not ready yet ({Message})", path, message ?? "no message");
            return new PreImportResult(PreImportStatus.NotReady, message);
        }
        catch (Exception ex)
        {
            return NotReady(path, ex.Message);
        }
    }

    /// <summary>
    /// True when <paramref name="replacement"/> (the validator's "path") exists on disk and is either the folder the
    /// download client's <paramref name="original"/> path sits in, or a file directly inside that folder. Anything
    /// else is not trusted.
    /// </summary>
    public static bool IsReplacementPath(string? original, string? replacement)
    {
        if (string.IsNullOrWhiteSpace(original) || string.IsNullOrWhiteSpace(replacement))
        {
            return false;
        }

        var folder = System.IO.Path.GetDirectoryName(original.TrimEnd('/', '\\'))?.TrimEnd('/', '\\');
        var candidate = replacement.TrimEnd('/', '\\');
        if (string.IsNullOrEmpty(folder) || string.IsNullOrEmpty(candidate))
        {
            return false;
        }

        if (Directory.Exists(candidate))
        {
            return string.Equals(candidate, folder, StringComparison.Ordinal);
        }

        return File.Exists(candidate) &&
               string.Equals(System.IO.Path.GetDirectoryName(candidate)?.TrimEnd('/', '\\'), folder, StringComparison.Ordinal);
    }

    private PreImportResult NotReady(string path, string reason)
    {
        _logger.LogWarning("PreImportValidator: could not get an answer for '{Path}' ({Reason}); deferring the import", path, reason);
        return new PreImportResult(PreImportStatus.NotReady, reason);
    }

    private static bool Flag(JsonElement root, string name) =>
        root.ValueKind == JsonValueKind.Object && root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.True;

    private static string? ReadUrl(string file, ILogger logger)
    {
        if (!File.Exists(file))
        {
            return null;
        }

        string? url = null;
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
                    logger.LogWarning("{File}: ignoring '{Line}' (expected Key=value)", FileName, line);
                    continue;
                }

                var key = line[..eq].Trim();
                var value = line[(eq + 1)..].Trim();
                if (key.Equals("Url", StringComparison.OrdinalIgnoreCase) ||
                    key.Equals("PreImportValidator.Url", StringComparison.OrdinalIgnoreCase))
                {
                    url = value;
                }
                else
                {
                    logger.LogWarning("{File}: ignoring unknown key '{Key}'", FileName, key);
                }
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "{File}: could not be read; no pre-import check is made", FileName);
            return null;
        }

        if (string.IsNullOrEmpty(url))
        {
            return null;
        }

        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            // Still configured: silently importing unchecked because of a typo would defeat the point, so every
            // check fails (and is logged) until the address is fixed.
            logger.LogWarning("{File}: Url '{Url}' is not an http(s) address; every import will be deferred until it is fixed", FileName, url);
        }

        return url;
    }
}
