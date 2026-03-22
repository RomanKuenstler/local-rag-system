#!/usr/bin/env bash

set -e

URLS_FILE="./urls.txt"
OUTPUT_DIR="./downloaded-html"
DELAY_SECONDS=1.2
USER_AGENT="LocalHTMLDownloader/1.1 (+offline-rag-preparation)"

mkdir -p "$OUTPUT_DIR"

if [ ! -f "$URLS_FILE" ]; then
  echo "URLs file not found: $URLS_FILE"
  exit 1
fi

echo "Reading URLs from $URLS_FILE"
echo "Saving HTML files to $OUTPUT_DIR"
echo ""

sanitize_filename() {
  echo "$1" \
    | sed -E 's|https?://||' \
    | sed -E 's|[/?&=#:%+]+|_|g' \
    | sed -E 's|_+|_|g' \
    | sed -E 's|^_+||' \
    | sed -E 's|_+$||' \
    | cut -c1-180
}

while IFS= read -r url || [[ -n "$url" ]]; do

  # skip empty lines and comments
  [[ -z "$url" ]] && continue
  [[ "$url" =~ ^# ]] && continue

  filename=$(sanitize_filename "$url")

  if [ -z "$filename" ]; then
    filename="downloaded_page"
  fi

  html_file="$OUTPUT_DIR/$filename.html"
  meta_file="$OUTPUT_DIR/$filename.json"

  echo "Downloading: $url"

  start_time=$(date -Iseconds)

  http_status=$(curl \
    -L \
    -A "$USER_AGENT" \
    -H "Accept: text/html,application/xhtml+xml" \
    -w "%{http_code}" \
    -o "$html_file" \
    -s \
    "$url")

  end_time=$(date -Iseconds)

  if [ "$http_status" != "200" ]; then
    echo "Failed (HTTP $http_status): $url"
    rm -f "$html_file"
    continue
  fi

  cat <<EOF > "$meta_file"
{
  "requestedUrl": "$url",
  "status": $http_status,
  "savedHtmlFile": "$(basename "$html_file")",
  "downloadedAt": "$end_time",
  "startedAt": "$start_time",
  "finishedAt": "$end_time",
  "userAgent": "$USER_AGENT"
}
EOF

  echo "Saved: $html_file"
  echo "Meta:  $meta_file"
  echo ""

  sleep "$DELAY_SECONDS"

done < "$URLS_FILE"

echo "Done."
