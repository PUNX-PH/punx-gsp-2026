using NUnit.Framework;
using Runner.Loading;

namespace Runner.Tests
{
    public class FrameTimeoutTests
    {
        [Test]
        public void Not_expired_before_the_limit()
        {
            var timeout = new FrameTimeout(30f, 1f);
            for (var i = 0; i < 29; i++) Assert.IsFalse(timeout.Tick(1f));
            Assert.AreEqual(29f, timeout.Elapsed, 1e-4f);
        }

        [Test]
        public void Expires_once_the_frame_times_add_up_to_the_limit()
        {
            var timeout = new FrameTimeout(30f, 1f);
            for (var i = 0; i < 29; i++) timeout.Tick(1f);
            Assert.IsTrue(timeout.Tick(1f));
            Assert.IsTrue(timeout.Tick(0f), "stays expired");
        }

        [Test]
        public void One_long_frame_counts_for_at_most_the_step_cap()
        {
            // A WebGL player can spend a minute on its first frame; that is not a minute of waiting for the network.
            var timeout = new FrameTimeout(30f);
            Assert.IsFalse(timeout.Tick(60f));
            Assert.AreEqual(0.25f, timeout.Elapsed, 1e-5f);
        }

        [Test]
        public void Step_cap_can_be_set()
        {
            var timeout = new FrameTimeout(1f, 0.5f);
            Assert.IsFalse(timeout.Tick(10f));
            Assert.IsTrue(timeout.Tick(10f));
        }

        [Test]
        public void Normal_frames_are_counted_in_full()
        {
            var timeout = new FrameTimeout(30f);
            for (var i = 0; i < 100; i++) timeout.Tick(1f / 60f);
            Assert.AreEqual(100f / 60f, timeout.Elapsed, 1e-3f);
        }
    }
}
