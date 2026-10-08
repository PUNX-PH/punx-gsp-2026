using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Runner.Engine
{
    /// <summary>A parsed JSON object: keys in the order they were written (a repeated key keeps its first place and its last value, as JSON.parse does).</summary>
    public sealed class JsonObject
    {
        public readonly List<string> Keys = new List<string>();
        public readonly Dictionary<string, object> Map = new Dictionary<string, object>();

        public bool Has(string key) => Map.ContainsKey(key);
        public object Get(string key) => Map.TryGetValue(key, out var v) ? v : null;
    }

    /// <summary>
    /// A small JSON reader for the game spec: objects become <see cref="JsonObject"/>, lists <see cref="List{Object}"/>, numbers <see cref="double"/>,
    /// strings, booleans and null as themselves. It exists because JsonUtility cannot read a list of differently shaped objects, and so that the
    /// spec's checks can say exactly what the web's checker says. Pure C#, no Unity types.
    /// </summary>
    public static class MiniJson
    {
        public static bool TryParse(string text, out object value, out string error)
        {
            var p = new Reader(text);
            try
            {
                p.SkipSpace();
                value = p.Value(0);
                p.SkipSpace();
                if (p.Pos != text.Length) throw new FormatException("unexpected text after the end");
                error = null;
                return true;
            }
            catch (FormatException e)
            {
                value = null;
                error = e.Message;
                return false;
            }
        }

        sealed class Reader
        {
            readonly string s;
            public int Pos;
            public Reader(string text) { s = text; }

            public void SkipSpace()
            {
                while (Pos < s.Length && (s[Pos] == ' ' || s[Pos] == '\t' || s[Pos] == '\n' || s[Pos] == '\r')) Pos++;
            }

            FormatException Fail(string what) => new FormatException(what + " at " + Pos);

            public object Value(int depth)
            {
                if (depth > 64) throw Fail("too deep");
                if (Pos >= s.Length) throw Fail("unexpected end");
                var c = s[Pos];
                if (c == '{') return Object(depth);
                if (c == '[') return List(depth);
                if (c == '"') return String();
                if (c == 't') return Word("true", true);
                if (c == 'f') return Word("false", false);
                if (c == 'n') return Word("null", null);
                return Number();
            }

            object Word(string word, object result)
            {
                if (string.CompareOrdinal(s, Pos, word, 0, word.Length) != 0) throw Fail("unexpected text");
                Pos += word.Length;
                return result;
            }

            object Number()
            {
                var start = Pos;
                while (Pos < s.Length && "+-0123456789.eE".IndexOf(s[Pos]) >= 0) Pos++;
                if (Pos == start || !double.TryParse(s.Substring(start, Pos - start), NumberStyles.Float, CultureInfo.InvariantCulture, out var d)) throw Fail("bad number");
                return d;
            }

            string String()
            {
                Pos++;
                var sb = new StringBuilder();
                while (true)
                {
                    if (Pos >= s.Length) throw Fail("unterminated string");
                    var c = s[Pos++];
                    if (c == '"') return sb.ToString();
                    if (c != '\\') { sb.Append(c); continue; }
                    if (Pos >= s.Length) throw Fail("unterminated string");
                    var e = s[Pos++];
                    switch (e)
                    {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'u':
                            if (Pos + 4 > s.Length || !int.TryParse(s.Substring(Pos, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var code)) throw Fail("bad escape");
                            sb.Append((char)code);
                            Pos += 4;
                            break;
                        default: throw Fail("bad escape");
                    }
                }
            }

            object List(int depth)
            {
                Pos++;
                var list = new List<object>();
                SkipSpace();
                if (Pos < s.Length && s[Pos] == ']') { Pos++; return list; }
                while (true)
                {
                    SkipSpace();
                    list.Add(Value(depth + 1));
                    SkipSpace();
                    if (Pos >= s.Length) throw Fail("unterminated list");
                    if (s[Pos] == ',') { Pos++; continue; }
                    if (s[Pos] == ']') { Pos++; return list; }
                    throw Fail("expected , or ]");
                }
            }

            object Object(int depth)
            {
                Pos++;
                var obj = new JsonObject();
                SkipSpace();
                if (Pos < s.Length && s[Pos] == '}') { Pos++; return obj; }
                while (true)
                {
                    SkipSpace();
                    if (Pos >= s.Length || s[Pos] != '"') throw Fail("expected a key");
                    var key = String();
                    SkipSpace();
                    if (Pos >= s.Length || s[Pos] != ':') throw Fail("expected :");
                    Pos++;
                    SkipSpace();
                    var v = Value(depth + 1);
                    if (!obj.Map.ContainsKey(key)) obj.Keys.Add(key);
                    obj.Map[key] = v;
                    SkipSpace();
                    if (Pos >= s.Length) throw Fail("unterminated object");
                    if (s[Pos] == ',') { Pos++; continue; }
                    if (s[Pos] == '}') { Pos++; return obj; }
                    throw Fail("expected , or }");
                }
            }
        }
    }
}
