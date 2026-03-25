package server

import (
	"bytes"
	"io"
	"mime/multipart"
	"net/url"
	"strings"
)

func resolveBodyFields(fields []BodyFieldKV, env map[string]string) []BodyFieldKV {
	if len(fields) == 0 {
		return []BodyFieldKV{}
	}

	resolved := make([]BodyFieldKV, 0, len(fields))
	for _, field := range fields {
		if !field.Enabled {
			continue
		}

		key := strings.TrimSpace(applyEnv(field.Key, env))
		if key == "" {
			continue
		}

		resolved = append(resolved, BodyFieldKV{
			Key:     key,
			Value:   applyEnv(field.Value, env),
			Enabled: true,
		})
	}

	return resolved
}

func buildRequestBody(mode string, rawBody string, fields []BodyFieldKV) (io.Reader, string, error) {
	switch normalizeRequestBodyMode(mode) {
	case "form_urlencoded":
		encoded := encodeFormURLEncodedBody(fields)
		return strings.NewReader(encoded), "application/x-www-form-urlencoded", nil
	case "multipart":
		body, contentType, err := encodeMultipartBody(fields)
		if err != nil {
			return nil, "", err
		}
		return bytes.NewReader(body), contentType, nil
	default:
		if rawBody == "" {
			return nil, "", nil
		}
		return strings.NewReader(rawBody), "", nil
	}
}

func encodeFormURLEncodedBody(fields []BodyFieldKV) string {
	if len(fields) == 0 {
		return ""
	}

	parts := make([]string, 0, len(fields))
	for _, field := range fields {
		parts = append(parts, url.QueryEscape(field.Key)+"="+url.QueryEscape(field.Value))
	}
	return strings.Join(parts, "&")
}

func encodeMultipartBody(fields []BodyFieldKV) ([]byte, string, error) {
	var buffer bytes.Buffer
	writer := multipart.NewWriter(&buffer)
	for _, field := range fields {
		if err := writer.WriteField(field.Key, field.Value); err != nil {
			return nil, "", err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, "", err
	}
	return buffer.Bytes(), writer.FormDataContentType(), nil
}
