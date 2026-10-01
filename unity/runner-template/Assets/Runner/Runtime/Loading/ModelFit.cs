using System;
using UnityEngine;

namespace Runner.Loading
{
    public static class ModelFit
    {
        /// <summary>
        /// Scale and offset that make a model targetHeight tall with the centre of its base at the origin.
        /// Apply the scale to the model, then add the offset to its position.
        /// </summary>
        public static (float scale, Vector3 offset) Compute(Bounds bounds, float targetHeight)
        {
            if (bounds.size.y <= 1e-4f) throw new ArgumentException("model has no height", nameof(bounds));

            var scale = targetHeight / bounds.size.y;
            var baseCentre = new Vector3(bounds.center.x, bounds.min.y, bounds.center.z);
            return (scale, -baseCentre * scale);
        }
    }
}
