"""Feature vectors computed from one reply's numbers.

Mirrored by core/trace/features.go.
"""

from __future__ import annotations

import numpy as np

from .parsing import DIMENSION

ALPHA = 0.5  # additive smoothing for the value histogram
ORDERED_CHUNKS = 4  # the reply is split into this many position chunks
ORDERED_BINS = 16  # value bins per chunk
ORDERED_DIM = ORDERED_CHUNKS * ORDERED_BINS + 10


def hellinger_feature(counts) -> np.ndarray:
    """Square root of the smoothed value distribution (355 values)."""
    values = np.asarray(counts, dtype=np.float64) + ALPHA
    return np.sqrt(values / values.sum())


def ordered_block_feature(numbers) -> np.ndarray:
    """Per-chunk 16-bin value histograms plus the last-digit distribution (74 values)."""
    values = np.asarray(numbers, dtype=np.float64)
    pieces = []
    for chunk in np.array_split(values, ORDERED_CHUNKS):
        counts, _ = np.histogram(chunk, bins=ORDERED_BINS, range=(1.0, float(DIMENSION + 1)))
        smoothed = counts.astype(np.float64) + 0.5
        pieces.append(np.sqrt(smoothed / smoothed.sum()))
    last_digits = np.bincount(values.astype(int) % 10, minlength=10).astype(np.float64) + 0.5
    pieces.append(np.sqrt(last_digits / last_digits.sum()))
    return np.concatenate(pieces)


def combined_feature(numbers, counts) -> np.ndarray:
    """Input of the family classifier: both feature blocks side by side (429 values)."""
    return np.concatenate([hellinger_feature(counts), ordered_block_feature(numbers)])
