"""Build the pinned offline HWP engine (same patch as the Android app: TTC/variable fonts that cannot be
subsetted fall back to vector outlines, so Windows TTC fonts such as batang.ttc work too).
Output: web/hwp/rhwptopdf.umd.js + web/hwp/rhwptopdf.umd_bg.wasm (not committed; produced by CI)."""
import argparse
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
PIN = "adbc4bf0f5c6e041ed65b0dbc8aa6b810990a48b"
parser = argparse.ArgumentParser()
parser.add_argument("--source", type=Path, default=ROOT / ".hwp-engine-source")
parser.add_argument("--out", type=Path, default=ROOT / "web/hwp")
args = parser.parse_args()
source = args.source.resolve()
head = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
if head != PIN:
    raise RuntimeError("Unexpected HWP engine source revision: " + head)
api = source / "src/wasm_api.rs"
original = api.read_text()
needle = "svg2pdf::to_chunk(&tree, svg2pdf::ConversionOptions::default())"
if original.count(needle) != 1:
    raise RuntimeError("HWP engine PDF conversion call changed; patch requires review")
patched = original.replace(needle, "pdfnote_convert_svg(&tree)")
helper = r'''
// PDF Note modification: Android system TTC/variable fonts may not be
// subsettable. Preserve text where possible; retry font errors as vector paths.
fn pdfnote_convert_svg(tree: &usvg::Tree) -> Result<(pdf_writer::Chunk, pdf_writer::Ref), svg2pdf::ConversionError> {
    match svg2pdf::to_chunk(tree, svg2pdf::ConversionOptions::default()) {
        Err(svg2pdf::ConversionError::SubsetError(_)) |
        Err(svg2pdf::ConversionError::InvalidFont(_)) =>
            svg2pdf::to_chunk(tree, svg2pdf::ConversionOptions {
                embed_text: false,
                ..svg2pdf::ConversionOptions::default()
            }),
        result => result,
    }
}

#[cfg(test)]
mod pdfnote_font_regression {
    #[test]
    fn pdfnote_cjk_outline_regression() {
        let path = std::env::var("PDFNOTE_TEST_FONT").expect("Korean TTC regression font is required");
        let data = std::fs::read(path).expect("Read Korean TTC");
        assert!(!super::register_pdf_font(&data).is_empty());
        let options = super::build_usvg_options();
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="600" height="100"><text x="10" y="60" font-family="serif" font-size="24">한글 변환 테스트 토큰증권 2026</text></svg>"#;
        let tree = usvg::Tree::from_str(svg, &options).unwrap();
        let original = svg2pdf::to_chunk(&tree, svg2pdf::ConversionOptions::default());
        println!("Original embedded-font conversion: {:?}", original.as_ref().map(|_| "ok").map_err(|e| e.to_string()));
        super::pdfnote_convert_svg(&tree).expect("Production conversion with font-error fallback");
        let pdf = svg2pdf::to_pdf(&tree, svg2pdf::ConversionOptions {
            embed_text: false,
            ..svg2pdf::ConversionOptions::default()
        }, svg2pdf::PageOptions::default()).expect("Outline conversion must work with TTC");
        assert!(pdf.starts_with(b"%PDF-"));
        assert!(pdf.len() > 1000, "Text outlines must be present");
        println!("Korean TTC outline PDF generated: {} bytes", pdf.len());
    }
}
'''
api.write_text(patched + helper)
subprocess.run(["cargo", "test", "--locked", "--manifest-path", str(source / "Cargo.toml"),
                "--lib", "pdfnote_cjk_outline_regression", "--", "--nocapture"], check=True)
subprocess.run(["wasm-pack", "build", str(source), "--target", "no-modules", "--release",
                "--out-dir", "pkg-pdfnote", "--out-name", "rhwptopdf", "--", "--locked"], check=True)
pkg = source / "pkg-pdfnote"
subprocess.run(["node", str(source / "scripts/wrap_umd.mjs"),
                str(pkg / "rhwptopdf.js"), str(pkg / "rhwptopdf.umd.js")], check=True)
assets = args.out.resolve()
assets.mkdir(parents=True, exist_ok=True)
shutil.copy2(pkg / "rhwptopdf.umd.js", assets / "rhwptopdf.umd.js")
shutil.copy2(pkg / "rhwptopdf_bg.wasm", assets / "rhwptopdf.umd_bg.wasm")
print("Built verified offline HWP engine with font-error fallback ->", assets)
