# Keep macOS host native while using Tauri for Windows and Linux host surfaces

TapPad needs a consistent desktop host surface across supported target backends, but macOS is the first commercial backend and already has native pairing, settings, and permission surfaces. We will keep the macOS host surface native while using Tauri for Windows and Linux host surfaces, so the product contract stays consistent without forcing the commercial macOS path through a cross-platform rewrite.
