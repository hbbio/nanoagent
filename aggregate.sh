#!/bin/bash

# Output file
output="all.txt"
> "$output"  # Clear output

# List of files to aggregate, in order
files=(
  README.md
  CODING_GUIDELINES.md
  src/content.ts
  src/json.ts
  src/schema.ts
  src/tool.ts
  src/message.ts
  src/model.ts
  src/yes.ts
  src/workflow.ts
  src/guess.test.ts
)

# Define custom prefaces (shown BEFORE the corresponding file)
declare -A preface
preface["README.md"]="\n// --- This is the complete source for the following project ---\n"
preface["src/content.ts"]="\n// --- 🧩 Starting the codebase ---\n"
preface["src/guess.test.ts"]="\n// --- 🛠 And now one global test ---\n"

# Process each file
for file in "${files[@]}"; do
  if [[ -n "${preface[$file]}" ]]; then
    echo -e "${preface[$file]}" >> "$output"
  fi

  echo "================================================================================" >> "$output"
  echo ">>> FILE: $file" >> "$output"
  echo "================================================================================" >> "$output"
  cat "$file" >> "$output"
  echo -e "\n\n" >> "$output"
done
