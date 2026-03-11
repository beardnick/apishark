package server

import (
	"bufio"
	"io"
	"strings"
)

type LineReader struct {
	reader *bufio.Reader
}

func NewLineReader(input io.Reader) *LineReader {
	return &LineReader{
		reader: bufio.NewReader(input),
	}
}

func (l *LineReader) ReadLine() (string, error) {
	line, err := l.reader.ReadString('\n')
	return strings.TrimRight(line, "\r\n"), err
}
