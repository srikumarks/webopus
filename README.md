
webopus.js wraps the opus codec and @erikd's [sample rate converter library][src] into
a single js file that can be loaded as a web worker and interacted with by
message passing. 

Since a full sample rate converter is included and automatically inserted into
the processing pipeline when needed, you can work with audio streams that have
any sampling rate even if they aren't supported by the opus codec.

LICENSE: GNU General Public License

### Installation

1. Install [emscripten][] into `~/emsdk-portable`.
2. Run `make` within this folder.
3. Go for a coffee break.
4. Come back and grab the `build/webopus.min.js` file.

[src]: https://github.com/erikd/libsamplerate

