import importlib.util
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "validate_industry_planes.py"
spec = importlib.util.spec_from_file_location("validate_industry_planes", MODULE_PATH)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_all_industry_planes_are_complete_contracts():
    module.validate()
