// Command wasm exposes trace.Categorize to the browser. Build with TinyGo:
//
//	tinygo build -o trace.wasm -target=wasm-unknown -no-debug -opt=z ./cmd/wasm
//
// Calling convention (all integers little-endian):
//   - buffer(n) returns a pointer to n writable bytes; the caller copies input there.
//   - load_bank(n) decodes the bank from the first n bytes; returns the model count or -1.
//   - count(n) returns how many numbers the text in the first n bytes contains.
//   - minimum(expected) returns how many numbers a reply needs to count.
//   - categorize(n) reads replies from the first n bytes — u32 count, then per reply u32 expected
//     count, u32 byte length, UTF-8 text — and returns how many float64 values it wrote at result().
//     Layout: used, tier, top, family_top, known, models M, families F, probs[M], family_probs[F],
//     replies R, then per reply: parsed, minimum, accepted (0/1), top.
package main

import (
	"encoding/binary"
	"unsafe"

	"github.com/xqy2006/modeltrace/core/trace"
)

var (
	input  []byte
	output []float64
	bank   *trace.Bank
)

func main() {}

//export buffer
func buffer(n int32) uintptr {
	if int(n) > cap(input) {
		input = make([]byte, n)
	}
	input = input[:n]
	return uintptr(unsafe.Pointer(&input[0]))
}

//export result
func result() uintptr {
	if len(output) == 0 {
		return 0
	}
	return uintptr(unsafe.Pointer(&output[0]))
}

//export load_bank
func loadBank(n int32) int32 {
	b, err := trace.Open(append([]byte(nil), input[:n]...))
	if err != nil {
		return -1
	}
	bank = b
	return int32(len(b.Models))
}

//export count
func count(n int32) int32 {
	return int32(len(trace.ParseNumbers(string(input[:n]))))
}

//export minimum
func minimum(expected int32) int32 {
	if bank == nil {
		return -1
	}
	return int32(bank.MinimumNumbers(int(expected)))
}

//export categorize
func categorize(n int32) int32 {
	if bank == nil {
		return -1
	}
	data := input[:n]
	replies := make([]trace.Reply, 0, 3)
	if len(data) >= 4 {
		count := int(binary.LittleEndian.Uint32(data))
		pos := 4
		for i := 0; i < count && pos+8 <= len(data); i++ {
			expected := int(binary.LittleEndian.Uint32(data[pos:]))
			size := int(binary.LittleEndian.Uint32(data[pos+4:]))
			pos += 8
			if pos+size > len(data) {
				break
			}
			replies = append(replies, trace.Reply{Text: string(data[pos : pos+size]), ExpectedCount: expected})
			pos += size
		}
	}
	r := trace.Categorize(bank, replies)
	output = output[:0]
	output = append(output, float64(r.Used), float64(r.Tier), float64(r.Top), float64(r.FamilyTop), r.Known,
		float64(len(bank.Models)), float64(len(bank.Families)))
	output = appendOrZeros(output, r.Probs, len(bank.Models))
	output = appendOrZeros(output, r.FamilyProbs, len(bank.Families))
	output = append(output, float64(len(r.Diagnostics)))
	for _, d := range r.Diagnostics {
		accepted := 0.0
		if d.Accepted {
			accepted = 1
		}
		output = append(output, float64(d.Parsed), float64(d.Minimum), accepted, float64(d.Top))
	}
	return int32(len(output))
}

func appendOrZeros(out, values []float64, n int) []float64 {
	if values == nil {
		return append(out, make([]float64, n)...)
	}
	return append(out, values...)
}
