package server

import (
	"errors"
	"fmt"
	"strings"
)

type ParsedCurl struct {
	Method  string
	URL     string
	Headers []HeaderKV
	Body    string
}

func ParseCurlCommand(input string) (*ParsedCurl, error) {
	tokens, err := shellSplit(input)
	if err != nil {
		return nil, err
	}
	if len(tokens) == 0 {
		return nil, errors.New("empty command")
	}

	if tokens[0] == "curl" {
		tokens = tokens[1:]
	}
	if len(tokens) == 0 {
		return nil, errors.New("missing curl arguments")
	}

	result := &ParsedCurl{
		Method: httpMethodGet,
	}

	for i := 0; i < len(tokens); i++ {
		token := tokens[i]

		switch {
		case token == "-X" || token == "--request":
			next, ok := readNext(tokens, &i)
			if !ok {
				return nil, fmt.Errorf("%s expects a value", token)
			}
			result.Method = strings.ToUpper(next)

		case strings.HasPrefix(token, "--request="):
			result.Method = strings.ToUpper(strings.TrimPrefix(token, "--request="))

		case strings.HasPrefix(token, "-X") && len(token) > 2:
			result.Method = strings.ToUpper(strings.TrimPrefix(token, "-X"))

		case token == "-H" || token == "--header":
			next, ok := readNext(tokens, &i)
			if !ok {
				return nil, fmt.Errorf("%s expects a value", token)
			}
			if header := parseHeader(next); header.Key != "" {
				result.Headers = append(result.Headers, header)
			}

		case strings.HasPrefix(token, "--header="):
			if header := parseHeader(strings.TrimPrefix(token, "--header=")); header.Key != "" {
				result.Headers = append(result.Headers, header)
			}

		case token == "-d" || token == "--data" || token == "--data-raw" || token == "--data-binary" || token == "--data-urlencode":
			next, ok := readNext(tokens, &i)
			if !ok {
				return nil, fmt.Errorf("%s expects a value", token)
			}
			result.Body = next
			if result.Method == httpMethodGet {
				result.Method = httpMethodPost
			}

		case strings.HasPrefix(token, "--data="),
			strings.HasPrefix(token, "--data-raw="),
			strings.HasPrefix(token, "--data-binary="),
			strings.HasPrefix(token, "--data-urlencode="):
			result.Body = token[strings.Index(token, "=")+1:]
			if result.Method == httpMethodGet {
				result.Method = httpMethodPost
			}

		case token == "--json":
			next, ok := readNext(tokens, &i)
			if !ok {
				return nil, fmt.Errorf("%s expects a value", token)
			}
			result.Body = next
			if result.Method == httpMethodGet {
				result.Method = httpMethodPost
			}
			result.Headers = appendHeaderIfMissing(result.Headers, HeaderKV{
				Key:   "Content-Type",
				Value: "application/json",
			})
			result.Headers = appendHeaderIfMissing(result.Headers, HeaderKV{
				Key:   "Accept",
				Value: "application/json",
			})

		case strings.HasPrefix(token, "--json="):
			result.Body = strings.TrimPrefix(token, "--json=")
			if result.Method == httpMethodGet {
				result.Method = httpMethodPost
			}
			result.Headers = appendHeaderIfMissing(result.Headers, HeaderKV{
				Key:   "Content-Type",
				Value: "application/json",
			})
			result.Headers = appendHeaderIfMissing(result.Headers, HeaderKV{
				Key:   "Accept",
				Value: "application/json",
			})

		case token == "--url":
			next, ok := readNext(tokens, &i)
			if !ok {
				return nil, fmt.Errorf("%s expects a value", token)
			}
			result.URL = next

		case strings.HasPrefix(token, "--url="):
			result.URL = strings.TrimPrefix(token, "--url=")

		case token == "-I" || token == "--head":
			result.Method = httpMethodHead

		case token == "-G" || token == "--get":
			result.Method = httpMethodGet

		case strings.HasPrefix(token, "http://") || strings.HasPrefix(token, "https://"):
			result.URL = token

		default:
			// Ignore unsupported flags to keep import tolerant.
		}
	}

	if result.URL == "" {
		return nil, errors.New("no URL found in curl command")
	}
	if result.Method == "" {
		result.Method = httpMethodGet
	}

	return result, nil
}

const (
	httpMethodGet  = "GET"
	httpMethodPost = "POST"
	httpMethodHead = "HEAD"
)

func parseHeader(raw string) HeaderKV {
	parts := strings.SplitN(raw, ":", 2)
	if len(parts) != 2 {
		return HeaderKV{}
	}
	return HeaderKV{
		Key:   strings.TrimSpace(parts[0]),
		Value: strings.TrimSpace(parts[1]),
	}
}

func appendHeaderIfMissing(headers []HeaderKV, candidate HeaderKV) []HeaderKV {
	for _, header := range headers {
		if strings.EqualFold(strings.TrimSpace(header.Key), strings.TrimSpace(candidate.Key)) {
			return headers
		}
	}
	return append(headers, candidate)
}

func readNext(tokens []string, index *int) (string, bool) {
	next := *index + 1
	if next >= len(tokens) {
		return "", false
	}
	*index = next
	return tokens[next], true
}

func shellSplit(input string) ([]string, error) {
	var tokens []string
	var current strings.Builder
	inSingle := false
	inDouble := false
	escaped := false

	flush := func() {
		if current.Len() == 0 {
			return
		}
		tokens = append(tokens, current.String())
		current.Reset()
	}

	for _, ch := range input {
		if escaped {
			if ch == '\n' || ch == '\r' {
				escaped = false
				continue
			}
			current.WriteRune(ch)
			escaped = false
			continue
		}

		switch ch {
		case '\\':
			if inSingle {
				current.WriteRune(ch)
			} else {
				escaped = true
			}
		case '\'':
			if inDouble {
				current.WriteRune(ch)
			} else {
				inSingle = !inSingle
			}
		case '"':
			if inSingle {
				current.WriteRune(ch)
			} else {
				inDouble = !inDouble
			}
		case ' ', '\n', '\t', '\r':
			if inSingle || inDouble {
				current.WriteRune(ch)
			} else {
				flush()
			}
		default:
			current.WriteRune(ch)
		}
	}

	if escaped {
		current.WriteRune('\\')
	}
	if inSingle || inDouble {
		return nil, errors.New("unclosed quote in curl command")
	}
	flush()
	return tokens, nil
}
