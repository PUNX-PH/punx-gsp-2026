using NUnit.Framework;

namespace Runner.Tests
{
    public class SmokeTests
    {
        [Test]
        public void Gltfast_package_is_installed()
        {
            Assert.IsNotNull(System.Type.GetType("GLTFast.GltfImport, glTFast"));
        }
    }
}
