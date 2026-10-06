using System;
using NUnit.Framework;
using Runner.Quality;

namespace Runner.Tests
{
    public class QualityGovernorTests
    {
        // Feeds frames of one length for about this many seconds (a whole number of frames).
        static void Run(QualityGovernor governor, float seconds, float frameSeconds)
        {
            var frames = (int)Math.Round(seconds / frameSeconds);
            for (var i = 0; i < frames; i++) governor.Add(frameSeconds);
        }

        [Test]
        public void The_numbers_are_the_designs()
        {
            Assert.AreEqual(3f, QualityGovernor.WindowSeconds);
            Assert.AreEqual(34f, QualityGovernor.StepAboveMs);
            Assert.AreEqual(5f, QualityGovernor.MinGapSeconds);
            Assert.AreEqual(3, QualityGovernor.MaxLevel);
        }

        [Test]
        public void A_game_that_starts_at_level_0()
        {
            Assert.AreEqual(0, new QualityGovernor().Level);
        }

        [Test]
        public void Three_seconds_of_16_ms_frames_never_step_and_neither_do_a_hundred()
        {
            var governor = new QualityGovernor();
            Run(governor, 3f, 0.016f);
            Assert.AreEqual(0, governor.Level);
            Run(governor, 100f, 0.016f);
            Assert.AreEqual(0, governor.Level);
        }

        [Test]
        public void Three_seconds_of_40_ms_frames_step_to_1_and_not_before_the_window_is_full()
        {
            var early = new QualityGovernor();
            Run(early, 2.8f, 0.04f);
            Assert.AreEqual(0, early.Level, "the window is not full yet");

            var governor = new QualityGovernor();
            Run(governor, 3.1f, 0.04f);
            Assert.AreEqual(1, governor.Level);
        }

        [Test]
        public void Right_after_a_step_slow_frames_wait_five_seconds_for_the_next_one()
        {
            var governor = new QualityGovernor();
            Run(governor, 3.1f, 0.04f);
            Assert.AreEqual(1, governor.Level);

            Run(governor, 4.5f, 0.04f); // 4.5 s after the step: not yet
            Assert.AreEqual(1, governor.Level);
            Run(governor, 1.0f, 0.04f); // 5.5 s: now
            Assert.AreEqual(2, governor.Level);
        }

        [Test]
        public void It_goes_on_to_3_and_stays_there()
        {
            var governor = new QualityGovernor();
            Run(governor, 3.1f, 0.04f);
            Run(governor, 5.5f, 0.04f);
            Run(governor, 5.5f, 0.04f);
            Assert.AreEqual(3, governor.Level);
            Run(governor, 60f, 0.04f);
            Assert.AreEqual(3, governor.Level);
            Assert.AreEqual(QualityGovernor.MaxLevel, governor.Level);
        }

        [Test]
        public void Fast_frames_after_a_step_do_not_lower_it()
        {
            var governor = new QualityGovernor();
            Run(governor, 3.1f, 0.04f);
            Assert.AreEqual(1, governor.Level);
            Run(governor, 60f, 0.016f);
            Assert.AreEqual(1, governor.Level, "the level never goes back up");
            Run(governor, 6f, 0.04f);
            Assert.AreEqual(2, governor.Level);
        }

        [Test]
        public void A_two_second_pause_counts_as_a_quarter_of_a_second_and_alone_does_not_step_a_fast_game()
        {
            var governor = new QualityGovernor();
            Run(governor, 3f, 0.016f);
            governor.Add(2.0f); // a tab switch, not slow hardware
            Run(governor, 0.5f, 0.016f);
            Assert.AreEqual(0, governor.Level);
            for (var i = 0; i < 5; i++)
            {
                governor.Add(2.0f);
                Run(governor, 3f, 0.016f);
            }
            Assert.AreEqual(0, governor.Level, "a pause now and then is not a slow game");
        }

        [Test]
        public void A_game_that_really_runs_at_a_quarter_of_a_second_a_frame_steps_even_though_long_frames_are_clamped()
        {
            var governor = new QualityGovernor();
            Run(governor, 3.5f, 0.25f);
            Assert.AreEqual(1, governor.Level);

            var clamped = new QualityGovernor();
            for (var i = 0; i < 20; i++) clamped.Add(2.0f); // frames of two seconds count as 250 ms each: still slow
            Assert.AreEqual(1, clamped.Level);
        }

        [Test]
        public void The_average_decides_not_one_slow_frame()
        {
            var governor = new QualityGovernor();
            for (var second = 0; second < 6; second++)
            {
                Run(governor, 0.9f, 0.016f);
                governor.Add(0.1f); // one hitch a second
            }
            Assert.AreEqual(0, governor.Level);
        }

        [Test]
        public void Only_the_last_three_seconds_count()
        {
            var governor = new QualityGovernor();
            Run(governor, 3.1f, 0.04f);
            Assert.AreEqual(1, governor.Level);
            Run(governor, 3.1f, 0.016f); // the slow frames are out of the window now
            Run(governor, 6f, 0.016f);
            Assert.AreEqual(1, governor.Level);
        }

        [Test]
        public void A_frame_that_is_not_a_time_is_ignored()
        {
            var governor = new QualityGovernor();
            governor.Add(0f);
            governor.Add(-1f);
            governor.Add(float.NaN);
            governor.Add(float.PositiveInfinity);
            Assert.AreEqual(0, governor.Level);
            Run(governor, 3f, 0.016f);
            Assert.AreEqual(0, governor.Level);
        }

        [Test]
        public void Just_under_and_just_over_34_ms()
        {
            var under = new QualityGovernor();
            Run(under, 10f, 0.033f);
            Assert.AreEqual(0, under.Level);

            var over = new QualityGovernor();
            Run(over, 4f, 0.036f);
            Assert.AreEqual(1, over.Level);
        }
    }
}
