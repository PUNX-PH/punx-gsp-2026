using System.Collections.Generic;

namespace Runner.Settings
{
    /// <summary>What <see cref="JsonKeys.Scan"/> found: the keys of every object, and the written form of every value that is not an object or a list.</summary>
    public sealed class JsonScan
    {
        /// <summary>
        /// For every object in the text, its keys in the order they were written, by the path of keys that leads to it: "" is the top-level object,
        /// "environment" the object under that key, "environment.world" the one under that. An object inside a list has no path, and nothing inside a
        /// list is listed. A key written twice is listed twice.
        /// </summary>
        public readonly Dictionary<string, List<string>> Keys = new Dictionary<string, List<string>>();

        /// <summary>
        /// The value of a key as it was written ("lit" with its quotes, 3, null, true), by the dotted path of the key itself ("look",
        /// "environment.world.style"). A key whose value is an object or a list has none.
        /// </summary>
        public readonly Dictionary<string, string> Values = new Dictionary<string, string>();

        public bool HasKey(string path)
        {
            var cut = path.LastIndexOf('.');
            var owner = cut < 0 ? "" : path.Substring(0, cut);
            return Keys.TryGetValue(owner, out var keys) && keys.Contains(path.Substring(cut + 1));
        }

        /// <summary>The text of a written string value without its quotes, or null when the key is not there or its value is not a string.</summary>
        public string String(string path)
        {
            if (!Values.TryGetValue(path, out var raw)) return null;
            return raw.Length >= 2 && raw[0] == '"' && raw[raw.Length - 1] == '"' ? raw.Substring(1, raw.Length - 2) : null;
        }
    }

    /// <summary>
    /// A look at the structure of a JSON text. JsonUtility gives a missing field and a field of the wrong type the same empty value, so for the few
    /// optional settings whose presence and type matter (the look, the world) the parser asks the text itself. This reads only structure: a string is
    /// skipped whole, so a key's name inside a string is never taken for a key; and it reads no value but to keep how it was written.
    /// </summary>
    public static class JsonKeys
    {
        /// <summary>The keys by path (see <see cref="JsonScan.Keys"/>).</summary>
        public static Dictionary<string, List<string>> ByPath(string json) => Scan(json).Keys;

        public static JsonScan Scan(string json)
        {
            var scan = new JsonScan();
            var names = new List<string>();      // one entry for each open container: the key it is the value of ("" at the top), or "[]" for a list
            var objects = new Stack<bool>();     // for each open container, whether it is an object
            string pending = null;               // the key just read, waiting for its value
            var i = 0;
            while (i < json.Length)
            {
                var c = json[i];
                if (c == '"')
                {
                    var end = EndOfString(json, i);
                    var inObject = objects.Count > 0 && objects.Peek();
                    var colon = NextNonSpace(json, end + 1);
                    if (end > i && json[end] == '"' && inObject && colon != -1 && json[colon] == ':')
                    {
                        pending = json.Substring(i + 1, end - i - 1);
                        var path = PathOf(names);
                        if (path != null)
                        {
                            if (!scan.Keys.TryGetValue(path, out var keys)) scan.Keys[path] = keys = new List<string>();
                            keys.Add(pending);
                            var value = NextNonSpace(json, colon + 1);
                            if (value != -1 && json[value] != '{' && json[value] != '[')
                                scan.Values[path.Length == 0 ? pending : path + "." + pending] = WrittenValue(json, value);
                        }
                    }
                    i = end + 1;
                    continue;
                }
                if (c == '{' || c == '[')
                {
                    names.Add(c == '{' ? (pending ?? "") : "[]");
                    objects.Push(c == '{');
                    pending = null;
                    if (c == '{')
                    {
                        // an object with no keys is still an object that is there
                        var path = PathOf(names);
                        if (path != null && !scan.Keys.ContainsKey(path)) scan.Keys[path] = new List<string>();
                    }
                }
                else if (c == '}' || c == ']')
                {
                    if (names.Count > 0) names.RemoveAt(names.Count - 1);
                    if (objects.Count > 0) objects.Pop();
                    pending = null;
                }
                else if (c == ',')
                {
                    pending = null;
                }
                i++;
            }
            return scan;
        }

        // The dotted path of the innermost object, or null when it is inside a list (or there is none).
        static string PathOf(List<string> names)
        {
            if (names.Count == 0) return null;
            for (var i = 0; i < names.Count; i++)
                if (names[i] == "[]") return null;
            return string.Join(".", names.GetRange(1, names.Count - 1));
        }

        // A string with its quotes, or a bare token (a number, true, false, null) up to a comma, a closing bracket or a space.
        static string WrittenValue(string json, int start)
        {
            if (json[start] == '"') return json.Substring(start, EndOfString(json, start) - start + 1);
            var end = start;
            while (end < json.Length && json[end] != ',' && json[end] != '}' && json[end] != ']' && !char.IsWhiteSpace(json[end])) end++;
            return json.Substring(start, end - start);
        }

        // The index of the quote that closes the string that opens at `start`, or the last index when it never closes.
        static int EndOfString(string json, int start)
        {
            for (var i = start + 1; i < json.Length; i++)
            {
                if (json[i] == '\\') i++;
                else if (json[i] == '"') return i;
            }
            return json.Length - 1;
        }

        // The index of the next character that is not white space, or -1.
        static int NextNonSpace(string json, int from)
        {
            for (var i = from; i < json.Length; i++)
                if (!char.IsWhiteSpace(json[i])) return i;
            return -1;
        }
    }
}
