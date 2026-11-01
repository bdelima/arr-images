using System.Text;
using System.Text.Json;

namespace Sportarr.Api.Services;

public enum PreImportStatus
{
    Ready,
    NotReady,
    Failed
}

public sealed record PreImportResult(PreImportStatus Status, string? Message);

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
/// Per check: POST {Url}/validate with {"path": "..."}, 10 second timeout. The answer is read from the JSON
/// body only: {"ready": bool, "failed": bool, "message": string}. "failed": true is Failed, "ready": true is
/// Ready, anything else is NotReady. A timeout, an HTTP error status or an unreadable body is also NotReady
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

    public async Task<PreImportResult> CheckAsync(string path)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, _validateUrl)
            {
                Content = new StringContent(JsonSerializer.Serialize(new Dictionary<string, string> { ["path"] = path }),
                    Encoding.UTF8, "application/json")
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
                return new PreImportResult(PreImportStatus.Ready, message);
            }

            _logger.LogDebug("PreImportValidator: '{Path}' is not ready yet ({Message})", path, message ?? "no message");
            return new PreImportResult(PreImportStatus.NotReady, message);
        }
        catch (Exception ex)
        {
            return NotReady(path, ex.Message);
        }
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
