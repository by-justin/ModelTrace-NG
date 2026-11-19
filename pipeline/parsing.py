"""Turning a model's reply into the list of numbers that gets scored.

The Go core (core/trace/parse.go) implements the same rules; keep them in step.
"""

from __future__ import annotations

import math
import re
from collections.abc import Iterable

VALUE_MIN = 1
VALUE_MAX = 355
DIMENSION = VALUE_MAX - VALUE_MIN + 1
MIN_NUMBERS = 80  # a reply needs at least max(MIN_NUMBERS, ceil(MIN_RATIO * expected)) numbers
MIN_RATIO = 0.55

_DIGITS = re.compile(r"[0-9]+")  # ASCII digits only, same as the Go and browser parsers


def parse_numbers(text: str) -> list[int]:
    """Longest run of in-range integers; letters between two numbers start a new run."""
    runs: list[list[int]] = []
    current: list[int] = []
    previous_end = 0
    for match in _DIGITS.finditer(text):
        separator = text[previous_end : match.start()]
        value = int(match.group())
        if current and any(character.isalpha() for character in separator):
            runs.append(current)
            current = []
        if VALUE_MIN <= value <= VALUE_MAX:
            current.append(value)
        previous_end = match.end()
    if current:
        runs.append(current)
    return max(runs, key=len) if runs else []


def minimum_numbers(expected_count: int) -> int:
    return max(MIN_NUMBERS, math.ceil(expected_count * MIN_RATIO)) if expected_count else MIN_NUMBERS


def count_numbers(numbers: Iterable[int]) -> list[int]:
    counts = [0] * DIMENSION
    for number in numbers:
        counts[number - VALUE_MIN] += 1
    return counts
