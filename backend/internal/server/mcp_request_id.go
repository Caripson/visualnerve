package server

import (
	"bytes"
	"encoding/json"
	"strconv"
	"strings"
	"unicode/utf8"
)

func validMCPRequestID(data json.RawMessage) bool {
	data = bytes.TrimSpace(data)
	if !utf8.Valid(data) || !json.Valid(data) {
		return false
	}
	if data[0] == '"' {
		return true
	}
	// JSON numbers remain lexical numbers, including values outside IEEE-754.
	// Decoding into float64 would round otherwise distinct request IDs.
	return data[0] == '-' || (data[0] >= '0' && data[0] <= '9')
}

func sameMCPRequestID(left, right json.RawMessage) bool {
	if !validMCPRequestID(left) || !validMCPRequestID(right) {
		return false
	}
	left, right = bytes.TrimSpace(left), bytes.TrimSpace(right)
	if left[0] == '"' || right[0] == '"' {
		if left[0] != '"' || right[0] != '"' {
			return false
		}
		var a, b string
		return json.Unmarshal(left, &a) == nil && json.Unmarshal(right, &b) == nil && a == b
	}
	return normalizedMCPNumber(string(left)) == normalizedMCPNumber(string(right))
}

// Normalize a finite JSON decimal symbolically. Exponents are decimal strings,
// not expanded powers or machine integers: even 1e-999999999999999999999 needs
// only linear work in the input length and cannot allocate an enormous rational.
func normalizedMCPNumber(value string) string {
	negative := strings.HasPrefix(value, "-")
	value = strings.TrimPrefix(value, "-")
	exponent := "0"
	if index := strings.IndexAny(value, "eE"); index >= 0 {
		exponent, value = value[index+1:], value[:index]
	}
	fraction := 0
	if index := strings.IndexByte(value, '.'); index >= 0 {
		fraction = len(value) - index - 1
		value = value[:index] + value[index+1:]
	}
	value = strings.TrimLeft(value, "0")
	if value == "" {
		return "0"
	}
	digits := strings.TrimRight(value, "0")
	exponent = addDecimalExponent(exponent, len(value)-len(digits)-fraction)
	if negative {
		digits = "-" + digits
	}
	return digits + "e" + exponent
}

func addDecimalExponent(value string, offset int) string {
	negative := strings.HasPrefix(value, "-")
	value = strings.TrimLeft(strings.TrimLeft(value, "+-"), "0")
	if value == "" {
		value, negative = "0", false
	}
	otherNegative := offset < 0
	other := strconv.Itoa(offset)
	other = strings.TrimPrefix(other, "-")
	if negative == otherNegative {
		value = decimalMagnitude(value, other, false)
	} else if len(value) < len(other) || (len(value) == len(other) && value < other) {
		value = decimalMagnitude(other, value, true)
		negative = otherNegative
	} else {
		value = decimalMagnitude(value, other, true)
	}
	if negative && value != "0" {
		return "-" + value
	}
	return value
}

// subtract requires left >= right. Both operands contain canonical digits.
func decimalMagnitude(left, right string, subtract bool) string {
	size := max(len(left), len(right))
	result := make([]byte, size+1)
	carry := 0
	for position := 0; position < size; position++ {
		a, b := 0, 0
		if index := len(left) - position - 1; index >= 0 {
			a = int(left[index] - '0')
		}
		if index := len(right) - position - 1; index >= 0 {
			b = int(right[index] - '0')
		}
		if subtract {
			a -= b + carry
			carry = 0
			if a < 0 {
				a += 10
				carry = 1
			}
		} else {
			a += b + carry
			carry, a = a/10, a%10
		}
		result[size-position] = byte(a) + '0'
	}
	result[0] = byte(carry) + '0'
	if subtract {
		result[0] = '0'
	}
	value := strings.TrimLeft(string(result), "0")
	if value == "" {
		return "0"
	}
	return value
}
