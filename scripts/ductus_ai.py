#!/usr/bin/env python3
"""Entry point; runtime requires Python 3.11+ and Git, no added dependencies."""
import sys
sys.dont_write_bytecode = True
from ai_runtime.cli import main
if __name__ == '__main__':
    raise SystemExit(main())
