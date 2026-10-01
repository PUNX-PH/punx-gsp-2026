using System;

namespace Runner.Loading
{
    public static class UrlTools
    {
        /// <summary>Reads a query-string value, decoded. False when absent or empty. A #fragment is ignored.</summary>
        public static bool TryGetQueryParam(string url, string key, out string value)
        {
            value = null;
            if (string.IsNullOrEmpty(url)) return false;

            var hash = url.IndexOf('#');
            if (hash >= 0) url = url.Substring(0, hash);
            var question = url.IndexOf('?');
            if (question < 0) return false;

            foreach (var pair in url.Substring(question + 1).Split('&'))
            {
                var equals = pair.IndexOf('=');
                if (equals < 0 || pair.Substring(0, equals) != key) continue;

                var decoded = Uri.UnescapeDataString(pair.Substring(equals + 1));
                if (decoded.Length == 0) return false;
                value = decoded;
                return true;
            }
            return false;
        }

        /// <summary>
        /// Makes urlOrRelative absolute against the page URL. An absolute URL comes back as is. With no page
        /// URL (the Editor) a relative URL is returned unchanged, so the fetch fails with a visible message.
        /// </summary>
        public static string ToAbsolute(string pageUrl, string urlOrRelative)
        {
            if (Uri.TryCreate(urlOrRelative, UriKind.Absolute, out var absolute)) return absolute.AbsoluteUri;
            if (!Uri.TryCreate(pageUrl, UriKind.Absolute, out var page)) return urlOrRelative;
            return new Uri(page, urlOrRelative).AbsoluteUri;
        }

        /// <summary>A file in the same folder as settingsUrl; its query and fragment are dropped.</summary>
        public static string SiblingUrl(string settingsUrl, string fileName)
        {
            var end = settingsUrl.IndexOfAny(new[] { '?', '#' });
            if (end >= 0) settingsUrl = settingsUrl.Substring(0, end);
            var slash = settingsUrl.LastIndexOf('/');
            return slash < 0 ? fileName : settingsUrl.Substring(0, slash + 1) + fileName;
        }
    }
}
