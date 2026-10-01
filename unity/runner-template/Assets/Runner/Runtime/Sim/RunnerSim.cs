using System;
using System.Collections.Generic;
using Runner.Settings;

namespace Runner.Sim
{
    public enum EntityKind { Obstacle, Collectible }

    public struct Entity
    {
        public EntityKind Kind;
        public float Z;
        public bool Active;
    }

    /// <summary>
    /// Deterministic one-touch runner. The hero runs along +Z at a constant speed, a jump is a fixed
    /// parabola, and obstacles and collectibles follow a fixed pattern. No Unity types, so it is
    /// tested without a scene.
    /// </summary>
    public sealed class RunnerSim
    {
        public const float Gravity = 30f;
        public const float ObstacleHeight = 1f;
        public const float HitHalfWidth = 0.8f;
        public const float FirstSpawnZ = 20f;
        public const float MaxDt = 0.05f;

        const float LookAhead = 60f;
        const float KeepBehind = 5f;

        readonly Tuning tuning;
        readonly List<Entity> entities = new List<Entity>();
        float verticalVelocity;
        int nextSlot;

        public RunnerSim(Tuning tuning)
        {
            this.tuning = tuning;
            Restart();
        }

        public float Z { get; private set; }
        public float HeroY { get; private set; }
        public bool Grounded { get; private set; }
        public int Score { get; private set; }
        public bool GameOver { get; private set; }

        /// <summary>Entities from 5 m behind the hero to 60 m ahead, in ascending Z, collected ones included.</summary>
        public IReadOnlyList<Entity> Entities => entities;

        public void Restart()
        {
            Z = 0f;
            HeroY = 0f;
            verticalVelocity = 0f;
            Grounded = true;
            Score = 0;
            GameOver = false;
            entities.Clear();
            nextSlot = 0;
            Spawn();
        }

        public void Tick(float dt, bool jump)
        {
            if (GameOver) return;
            dt = Math.Min(dt, MaxDt);

            if (jump && Grounded)
            {
                verticalVelocity = (float)Math.Sqrt(2f * Gravity * tuning.jumpHeight);
                Grounded = false;
            }
            if (!Grounded)
            {
                // Exact kinematics for constant acceleration, so the apex does not depend on the step size.
                HeroY += verticalVelocity * dt - 0.5f * Gravity * dt * dt;
                verticalVelocity -= Gravity * dt;
                if (HeroY <= 0f)
                {
                    HeroY = 0f;
                    verticalVelocity = 0f;
                    Grounded = true;
                }
            }

            Z += tuning.speed * dt;
            Spawn();
            Prune();
            Collide();
        }

        // One obstacle every obstacleSpacing metres from FirstSpawnZ, and a collectible at each midpoint.
        void Spawn()
        {
            while (FirstSpawnZ + nextSlot * tuning.obstacleSpacing <= Z + LookAhead)
            {
                var z = FirstSpawnZ + nextSlot * tuning.obstacleSpacing;
                entities.Add(new Entity { Kind = EntityKind.Obstacle, Z = z, Active = true });
                entities.Add(new Entity { Kind = EntityKind.Collectible, Z = z + tuning.obstacleSpacing * 0.5f, Active = true });
                nextSlot++;
            }
        }

        void Prune()
        {
            var behind = 0;
            while (behind < entities.Count && entities[behind].Z < Z - KeepBehind) behind++;
            if (behind > 0) entities.RemoveRange(0, behind);
        }

        void Collide()
        {
            for (var i = 0; i < entities.Count; i++)
            {
                var e = entities[i];
                if (!e.Active || Math.Abs(Z - e.Z) >= HitHalfWidth) continue;

                if (e.Kind == EntityKind.Obstacle)
                {
                    if (HeroY < ObstacleHeight) GameOver = true;
                }
                else
                {
                    e.Active = false;
                    entities[i] = e;
                    Score++;
                }
            }
        }
    }
}
