"""Unit tests for the worker's pure helpers. Run: DATABASE_URL=x python -m unittest worker/test_worker.py"""
import os
import unittest

os.environ.setdefault("DATABASE_URL", "postgresql://unused")
import worker  # noqa: E402

TURNS = [(0, 3000, "Speaker 1"), (3500, 9000, "Speaker 2"), (9400, 12000, "Speaker 1")]


def seg(start, end, words):
    return {"start": start, "end": end, "text": " ".join(w for _, _, w in words),
            "words": [{"start": a, "end": b, "word": " " + w} for a, b, w in words]}


class SpeakerAt(unittest.TestCase):
    def test_overlap_wins(self):
        self.assertEqual(worker.speaker_at(4000, 5000, TURNS), "Speaker 2")

    def test_word_in_a_pause_takes_nearest_turn(self):
        self.assertEqual(worker.speaker_at(3050, 3150, TURNS), "Speaker 1")
        self.assertEqual(worker.speaker_at(9250, 9350, TURNS), "Speaker 1")

    def test_no_turns(self):
        self.assertIsNone(worker.speaker_at(0, 100, []))


class SplitBySpeaker(unittest.TestCase):
    def test_splits_a_whisper_segment_into_sentences_with_their_own_speaker(self):
        s = seg(2000, 5000, [(2000, 2600, "any"), (2600, 2900, "questions?"), (3600, 4200, "Yes,"), (4200, 4900, "one.")])
        cues = worker.split_by_speaker([s], TURNS)
        self.assertEqual([(c["speaker"], c["text"]) for c in cues], [("Speaker 1", "any questions?"), ("Speaker 2", "Yes, one.")])
        self.assertEqual((cues[1]["start"], cues[1]["end"]), (3600, 4900))

    def test_a_flickering_word_does_not_split_a_sentence(self):
        # One word of the sentence falls into the other speaker's turn; the sentence stays whole with the majority speaker.
        s = seg(7000, 9700, [(7000, 7800, "Component"), (7800, 8600, "selection"), (8600, 9000, "takes"), (9400, 9700, "days.")])
        cues = worker.split_by_speaker([s], TURNS)
        self.assertEqual([(c["speaker"], c["text"]) for c in cues], [("Speaker 2", "Component selection takes days.")])

    def test_long_pause_breaks_a_sentence(self):
        s = seg(0, 6000, [(0, 500, "Well"), (4000, 4500, "anyway.")])
        self.assertEqual(len(worker.split_by_speaker([s], TURNS)), 2)

    def test_without_turns_keeps_segments_and_no_speaker(self):
        cues = worker.split_by_speaker([seg(0, 1000, [(0, 500, "Hello"), (500, 1000, "there.")])], [])
        self.assertEqual([(c["speaker"], c["text"]) for c in cues], [(None, "Hello there.")])

    def test_segment_without_words_falls_back_to_its_text(self):
        cues = worker.split_by_speaker([{"start": 4000, "end": 5000, "text": "Fine.", "words": []}], TURNS)
        self.assertEqual([(c["speaker"], c["text"]) for c in cues], [("Speaker 2", "Fine.")])


class Coalesce(unittest.TestCase):
    def test_merges_same_speaker_until_a_long_sentence_ends(self):
        cues = [{"start": 0, "end": 1000, "text": "I think", "speaker": "A"},
                {"start": 1200, "end": 2000, "text": "it works.", "speaker": "A"},
                {"start": 2100, "end": 3000, "text": "Good.", "speaker": "B"}]
        out = worker.coalesce(cues)
        self.assertEqual([(c["speaker"], c["text"]) for c in out], [("A", "I think it works."), ("B", "Good.")])

    def test_sentence_mode_keeps_questions_and_answers_apart(self):
        cues = [{"start": 0, "end": 1000, "text": "Where does it break?", "speaker": None},
                {"start": 1100, "end": 2000, "text": "In simulation.", "speaker": None}]
        self.assertEqual(len(worker.coalesce(cues, target=1)), 2)

    def test_never_merges_across_a_long_pause(self):
        cues = [{"start": 0, "end": 1000, "text": "first", "speaker": "A"}, {"start": 5000, "end": 6000, "text": "second", "speaker": "A"}]
        self.assertEqual(len(worker.coalesce(cues)), 2)


if __name__ == "__main__":
    unittest.main()
