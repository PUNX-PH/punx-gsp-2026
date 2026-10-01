using System;
using NUnit.Framework;
using Runner.Loading;
using UnityEngine;

namespace Runner.Tests
{
    public class LoadingHelperTests
    {
        const string PageWithParams = "https://h/index.html?settings=runs%2Fabc%2Fsettings.json&debug=1";

        [Test]
        public void Query_param_is_decoded()
        {
            Assert.IsTrue(UrlTools.TryGetQueryParam(PageWithParams, "settings", out var settings));
            Assert.AreEqual("runs/abc/settings.json", settings);
            Assert.IsTrue(UrlTools.TryGetQueryParam(PageWithParams, "debug", out var debug));
            Assert.AreEqual("1", debug);
        }

        [Test]
        public void Query_param_missing_or_empty_is_false()
        {
            Assert.IsFalse(UrlTools.TryGetQueryParam("https://h/index.html?settings=", "settings", out _));
            Assert.IsFalse(UrlTools.TryGetQueryParam("https://h/index.html", "settings", out _));
            Assert.IsFalse(UrlTools.TryGetQueryParam("https://h/index.html#settings=x", "settings", out _));
        }

        [Test]
        public void Query_param_ignores_the_fragment()
        {
            Assert.IsFalse(UrlTools.TryGetQueryParam("https://h/index.html?a=1#settings=x", "settings", out _));
            Assert.IsTrue(UrlTools.TryGetQueryParam("https://h/index.html?settings=x#frag", "settings", out var value));
            Assert.AreEqual("x", value);
        }

        [Test]
        public void ToAbsolute_resolves_relative_against_page()
        {
            Assert.AreEqual("https://h/p/runs/a/settings.json",
                UrlTools.ToAbsolute("https://h/p/index.html?settings=x", "runs/a/settings.json"));
            Assert.AreEqual("https://other/x/settings.json?v=2",
                UrlTools.ToAbsolute("https://h/p/index.html", "https://other/x/settings.json?v=2"));
        }

        [Test]
        public void ToAbsolute_leaves_relative_url_alone_without_a_page_url()
        {
            Assert.AreEqual("runs/a/settings.json", UrlTools.ToAbsolute("", "runs/a/settings.json"));
            Assert.AreEqual("runs/a/settings.json", UrlTools.ToAbsolute(null, "runs/a/settings.json"));
        }

        [Test]
        public void Sibling_url_replaces_file_and_drops_query()
        {
            Assert.AreEqual("https://h/runs/abc/hero.glb", UrlTools.SiblingUrl("https://h/runs/abc/settings.json?v=2", "hero.glb"));
        }

        [Test]
        public void Sibling_url_works_for_relative_settings_urls()
        {
            Assert.AreEqual("runs/abc/hero.glb", UrlTools.SiblingUrl("runs/abc/settings.json", "hero.glb"));
        }

        [Test]
        public void ModelFit_scales_to_target_height()
        {
            var (scale, offset) = ModelFit.Compute(new Bounds(new Vector3(1f, 2f, 3f), new Vector3(2f, 4f, 2f)), 1f);
            Assert.AreEqual(0.25f, scale, 1e-5f);
            Assert.AreEqual(-0.25f, offset.x, 1e-5f);
            Assert.AreEqual(0f, offset.y, 1e-5f);
            Assert.AreEqual(-0.75f, offset.z, 1e-5f);
        }

        [Test]
        public void ModelFit_rejects_flat_model()
        {
            Assert.Throws<ArgumentException>(() => ModelFit.Compute(new Bounds(Vector3.zero, new Vector3(1f, 0f, 1f)), 1f));
        }
    }
}
