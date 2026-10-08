using System.Collections.Generic;
using UnityEngine;

namespace Runner.Engine
{
    /// <summary>
    /// The four primitives a spec may name (box, sphere, capsule, cylinder), built in code, each one unit across and centered on the origin, so that a
    /// player build needs no physics module (CreatePrimitive would pull in a collider). Meshes are made once and shared.
    /// </summary>
    public static class PrimitiveMeshes
    {
        static readonly Dictionary<string, Mesh> Cache = new Dictionary<string, Mesh>();

        public static Mesh Get(string name)
        {
            if (Cache.TryGetValue(name, out var mesh) && mesh != null) return mesh;
            switch (name)
            {
                case "sphere": mesh = Sphere(12, 8, 1f); break;
                case "capsule": mesh = Sphere(12, 8, 1f); break; // drawn as a sphere stretched by the entity's size: the engine has no rounded body of its own
                case "cylinder": mesh = Cylinder(16); break;
                default: mesh = Box(); break;
            }
            mesh.name = "Engine " + name;
            Cache[name] = mesh;
            return mesh;
        }

        static Mesh Box()
        {
            var v = new List<Vector3>();
            var n = new List<Vector3>();
            var t = new List<int>();
            var faces = new[]
            {
                (Vector3.forward, Vector3.up, Vector3.right), (Vector3.back, Vector3.up, Vector3.left),
                (Vector3.up, Vector3.forward, Vector3.left), (Vector3.down, Vector3.forward, Vector3.right),
                (Vector3.right, Vector3.up, Vector3.back), (Vector3.left, Vector3.up, Vector3.forward),
            };
            foreach (var (normal, up, right) in faces)
            {
                var start = v.Count;
                var c = normal * 0.5f;
                v.Add(c - right * 0.5f - up * 0.5f);
                v.Add(c + right * 0.5f - up * 0.5f);
                v.Add(c + right * 0.5f + up * 0.5f);
                v.Add(c - right * 0.5f + up * 0.5f);
                for (var i = 0; i < 4; i++) n.Add(normal);
                t.AddRange(new[] { start, start + 2, start + 1, start, start + 3, start + 2 });
            }
            return Build(v, n, t);
        }

        static Mesh Sphere(int around, int rings, float diameter)
        {
            var v = new List<Vector3>();
            var n = new List<Vector3>();
            var t = new List<int>();
            for (var r = 0; r <= rings; r++)
            {
                var phi = Mathf.PI * r / rings;
                for (var a = 0; a <= around; a++)
                {
                    var theta = 2f * Mathf.PI * a / around;
                    var p = new Vector3(Mathf.Sin(phi) * Mathf.Cos(theta), Mathf.Cos(phi), Mathf.Sin(phi) * Mathf.Sin(theta));
                    v.Add(p * diameter * 0.5f);
                    n.Add(p);
                }
            }
            for (var r = 0; r < rings; r++)
            {
                for (var a = 0; a < around; a++)
                {
                    var i = r * (around + 1) + a;
                    t.AddRange(new[] { i, i + 1, i + around + 1, i + 1, i + around + 2, i + around + 1 });
                }
            }
            return Build(v, n, t);
        }

        static Mesh Cylinder(int around)
        {
            var v = new List<Vector3>();
            var n = new List<Vector3>();
            var t = new List<int>();
            for (var a = 0; a <= around; a++)
            {
                var theta = 2f * Mathf.PI * a / around;
                var d = new Vector3(Mathf.Cos(theta), 0f, Mathf.Sin(theta));
                v.Add(d * 0.5f + Vector3.down * 0.5f);
                v.Add(d * 0.5f + Vector3.up * 0.5f);
                n.Add(d);
                n.Add(d);
            }
            for (var a = 0; a < around; a++)
            {
                var i = a * 2;
                t.AddRange(new[] { i, i + 1, i + 2, i + 1, i + 3, i + 2 });
            }
            foreach (var up in new[] { true, false })
            {
                var center = v.Count;
                v.Add(up ? Vector3.up * 0.5f : Vector3.down * 0.5f);
                n.Add(up ? Vector3.up : Vector3.down);
                for (var a = 0; a <= around; a++)
                {
                    var theta = 2f * Mathf.PI * a / around;
                    v.Add(new Vector3(Mathf.Cos(theta) * 0.5f, up ? 0.5f : -0.5f, Mathf.Sin(theta) * 0.5f));
                    n.Add(up ? Vector3.up : Vector3.down);
                }
                for (var a = 0; a < around; a++)
                {
                    var i = center + 1 + a;
                    if (up) t.AddRange(new[] { center, i + 1, i });
                    else t.AddRange(new[] { center, i, i + 1 });
                }
            }
            return Build(v, n, t);
        }

        static Mesh Build(List<Vector3> v, List<Vector3> n, List<int> t)
        {
            var mesh = new Mesh();
            mesh.SetVertices(v);
            mesh.SetNormals(n);
            mesh.SetTriangles(t, 0);
            mesh.RecalculateBounds();
            return mesh;
        }
    }
}
