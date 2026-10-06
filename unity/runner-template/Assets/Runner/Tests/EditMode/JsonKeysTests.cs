using NUnit.Framework;
using Runner.Settings;

namespace Runner.Tests
{
    public class JsonKeysTests
    {
        // "(none)" for a path with no object there at all, so "no keys" and "no object" are different answers.
        static string Keys(string json, string path)
        {
            var all = JsonKeys.ByPath(json);
            return all.TryGetValue(path, out var keys) ? string.Join(",", keys) : "(none)";
        }

        [Test] public void Lists_the_keys_of_the_top_level_object_in_order() => Assert.AreEqual("a,b,c", Keys("{\"a\":1,\"b\":{\"x\":1},\"c\":[1,2]}", ""));

        [Test]
        public void Lists_the_keys_of_a_nested_object_by_its_path()
        {
            var json = "{\"a\":1,\"environment\":{\"sky\":0,\"world\":{\"style\":\"desert\",\"extra\":1}}}";
            Assert.AreEqual("a,environment", Keys(json, ""));
            Assert.AreEqual("sky,world", Keys(json, "environment"));
            Assert.AreEqual("style,extra", Keys(json, "environment.world"));
        }

        [Test]
        public void Does_not_take_text_inside_a_string_for_a_key()
        {
            Assert.AreEqual("a,b", Keys("{\"a\":\"\\\"look\\\": 1\",\"b\":2}", ""));
            Assert.AreEqual("a", Keys("{\"a\":\"{\\\"look\\\":1}\"}", ""));
            Assert.AreEqual("(none)", Keys("{\"a\":\"{\\\"look\\\":1}\"}", "a"));
        }

        [Test]
        public void Does_not_list_what_is_inside_an_array()
        {
            var json = "{\"a\":[{\"look\":1}],\"b\":1}";
            Assert.AreEqual("a,b", Keys(json, ""));
            Assert.AreEqual("(none)", Keys(json, "a"));
        }

        [Test]
        public void An_empty_object_is_there_with_no_keys()
        {
            var json = "{\"environment\":{\"world\":{}}}";
            Assert.AreEqual("", Keys(json, "environment.world"));
            Assert.AreEqual("(none)", Keys("{\"environment\":{\"world\":3}}", "environment.world"));
            Assert.AreEqual("(none)", Keys("{\"environment\":{\"world\":null}}", "environment.world"));
            Assert.AreEqual("(none)", Keys("{\"environment\":{\"world\":\"desert\"}}", "environment.world"));
            Assert.AreEqual("(none)", Keys("{\"environment\":{\"world\":[\"desert\"]}}", "environment.world"));
        }

        [Test]
        public void Reads_pretty_printed_text_the_same_way()
        {
            var json = "{\n  \"look\" : \"lit\",\n  \"environment\" : {\n    \"world\" : {\n      \"style\" : \"meadow\"\n    }\n  }\n}\n";
            Assert.AreEqual("look,environment", Keys(json, ""));
            Assert.AreEqual("style", Keys(json, "environment.world"));
        }

        [Test]
        public void Does_not_mix_up_a_key_that_comes_after_a_nested_object()
        {
            var json = "{\"environment\":{\"world\":{\"style\":\"desert\"},\"sky\":1},\"look\":\"lit\"}";
            Assert.AreEqual("environment,look", Keys(json, ""));
            Assert.AreEqual("world,sky", Keys(json, "environment"));
        }

        [Test]
        public void Keeps_how_a_value_was_written()
        {
            var scan = JsonKeys.Scan("{\"look\":\"lit\",\"n\":3,\"x\":null,\"flag\":true,\"environment\":{\"world\":{\"style\":\"desert\"}}}");
            Assert.AreEqual("\"lit\"", scan.Values["look"]);
            Assert.AreEqual("3", scan.Values["n"]);
            Assert.AreEqual("null", scan.Values["x"]);
            Assert.AreEqual("true", scan.Values["flag"]);
            Assert.AreEqual("\"desert\"", scan.Values["environment.world.style"]);
        }

        [Test]
        public void Reads_a_string_value_without_its_quotes_and_nothing_else_as_one()
        {
            var scan = JsonKeys.Scan("{\"look\":\"lit\",\"n\":3,\"x\":null,\"environment\":{\"world\":{\"style\":\"meadow\"}}}");
            Assert.AreEqual("lit", scan.String("look"));
            Assert.AreEqual("meadow", scan.String("environment.world.style"));
            Assert.IsNull(scan.String("n"));
            Assert.IsNull(scan.String("x"));
            Assert.IsNull(scan.String("missing"));
            Assert.IsNull(scan.String("environment.world")); // an object is not a string
        }

        [Test]
        public void Knows_which_keys_are_there_whatever_their_values()
        {
            var scan = JsonKeys.Scan("{\"look\":3,\"environment\":{\"world\":{},\"list\":[1]}}");
            Assert.IsTrue(scan.HasKey("look"));
            Assert.IsTrue(scan.HasKey("environment"));
            Assert.IsTrue(scan.HasKey("environment.world"));
            Assert.IsTrue(scan.HasKey("environment.list"));
            Assert.IsFalse(scan.HasKey("world"));
            Assert.IsFalse(scan.HasKey("environment.world.style"));
            Assert.IsFalse(scan.Values.ContainsKey("environment.world")); // an object has no written value
            Assert.IsFalse(scan.Values.ContainsKey("environment.list"));
        }

        [Test] public void Gives_nothing_for_text_that_has_no_object() => Assert.AreEqual(0, JsonKeys.ByPath("").Count);
        [Test] public void Survives_a_text_that_never_closes() => Assert.AreEqual("a", Keys("{\"a\":{\"b\":\"never ends", ""));
    }
}
