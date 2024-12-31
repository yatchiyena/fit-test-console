#!/usr/bin/env python3
# given an input stream, add timestamps to each line. If the input stream already has timestamps, update the timestamps
# ensure the timestamps are monotonically increasing by an increment of 1 second.
# useful for concatenating datasets together.
from datetime import datetime, timedelta
import fileinput
now = datetime.now()

# 2024-12-22T17:57:38.120Z Conc.            602 #/cc
for line in fileinput.input():
    now = now + timedelta(seconds=1)
    timestamp = now.strftime(f"%Y-%m-%dT%H:%M:%S.000Z")
    line = line.strip()
    parts = line.split(" ", 1)
    if(len(parts)>1):
        line = f"{timestamp} {parts[1]}"
    else:
        line = f"{timestamp} {line}"
    print(line)
