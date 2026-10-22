import unittest
from runtime import DIMENSIONS, encode


class Vector:
    def tolist(self):
        return [1.0] + [0.0] * (DIMENSIONS - 1)


class FakeModel:
    max_seq_length = 8192
    calls = []

    def tokenizer(self, text, truncation):
        assert truncation is False
        return {"input_ids": [0] * len(text)}

    def encode(self, text, **kwargs):
        self.calls.append(kwargs)
        return Vector()


class RuntimeTests(unittest.TestCase):
    def test_task_prompts_and_normalization(self):
        model = FakeModel()
        model.calls = []
        self.assertEqual(len(encode(model, "query", "search")), DIMENSIONS)
        encode(model, "document", "add")
        self.assertEqual(model.calls[0]["prompt"], "task: search result | query: ")
        self.assertEqual(model.calls[1]["prompt"], "title: none | text: ")
        self.assertTrue(all(c["normalize_embeddings"] for c in model.calls))

    def test_oversized_input_is_rejected_before_inference(self):
        model = FakeModel()
        model.calls = []
        for text, action in [("x" * 8192, "add"), ("x" * 32001, "search"), ("", "add"), ("x", "unknown")]:
            with self.assertRaises(ValueError):
                encode(model, text, action)
        self.assertEqual(model.calls, [])


if __name__ == "__main__":
    unittest.main()
