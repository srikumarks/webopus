
webopus.js wraps the [opus codec][opus] and @erikd's [sample rate converter library][src] into
a single js file that can be loaded as a web worker and interacted with by
message passing. 

Since a full sample rate converter is included and automatically inserted into
the processing pipeline when needed, you can work with audio streams that have
any sampling rate even if they aren't supported by the opus codec.

LICENSE: GNU General Public License

## Installation

1. Install [emscripten][] into `~/emsdk-portable`.
2. Run `make` within this folder.
3. Go for a coffee break.
4. Come back and grab the `build/webopus.min.js` file.

[src]: https://github.com/erikd/libsamplerate
[opus]: http://opus-codec.org
[emscripten]: http://kripken.github.io/emscripten-site/

## Testing

There is a smallish test suite part of the project written using Facebook jest
in the `tests/` folder.

Install jest using `yarn global add jest`.

To run the tests, just run `make test`.

## Usage

The resultant `webopus.min.js` is intended to be loaded as a web worker.

```
let worker = new Worker('/static/js/webopus.min.js');
...
```

Post loading, you interact with the worker by sending messages to it
that are tagged using a `stream` identifier that you decide. Each "stream"
can perform either a decoding job or an encoding job, both of which
follow a simple protocol described below.

> **NOTE**: Currently only mono streams are supported.

### Encoding

Messages part of an encoder stream look like this -

```
// First message starting a stream.
worker.postMessage({
    op: 'begin',
    stream: 'enc1', // Some unique id using which the messages will be associated.
    enc: new Float32Array(480),
    sampleRate: 48000,
    numChannels: 1
});

// Subsequent encoding messages need to be -
worker.postMessage({
    op: 'proc',
    stream: 'enc1',
    enc: new Float32Array(480)
});

// The final message that flushes the stream and
// cleans up resources used by it.
worker.postMessage({
    op: 'end',
    stream: 'enc1',
    enc: // Optional last buffer
});
```

To receive encoded packets, you need to override the worker's `onmessage` as follows -

```
worker.onmessage = function (event) {
    let msg = event.data;

    // msg.stream will be the stream ID you gave.
    // msg.enc will be a Uint8Array for an encoder stream.
    // msg.sampleRate will be the input sample rate.
    // msg.encSampleRate will be the sample rate at which the encoder runs.
    //                   That is solely for information purposes. You won't need it.
    // msg.numChannels the number of channels of audio.
    // msg.end Boolean indicating whether this is the last message
    //         associated with the stream and the stream should now
    //         be considered closed.
};
```

### Decoding

Decoder streams are very similar to encoder streams.

```
// First message starting a stream.
worker.postMessage({
    op: 'begin',
    stream: 'dec1', // Some unique id using which the messages will be associated.
    dec: new Uint8Array(34), // An opus codec packet.
    sampleRate: 48000, // The decoded sampling rate. This can be different from the encoded rate.
    numChannels: 1
});

// Subsequent encoding messages need to be -
worker.postMessage({
    op: 'proc',
    stream: 'dec1',
    dec: new Uint8Array(47)
});

// The final message that flushes the stream and
// cleans up resources used by it.
worker.postMessage({
    op: 'end',
    stream: 'dec1',
    dec: // Optional last packet
});
```

To receive decoded buffers, you need to override the worker's `onmessage` as follows -

```
worker.onmessage = function (event) {
    let msg = event.data;

    // msg.stream will be the stream ID you gave.
    // msg.dec will be a Float32Array for a decoder stream.
    // msg.sampleRate will be the input sample rate.
    // msg.encSampleRate will be the sample rate at which the encoder runs.
    //                   That is solely for information purposes. You won't need it.
    // msg.numChannels the number of channels of audio.
    // msg.end Boolean indicating whether this is the last message
    //         associated with the stream and the stream should now
    //         be considered closed.
};
```

## Constraints

1. Since a sample rate converter is included, you can also work with
   non-Opus-compatible sampling rates such as 44.1KHz. When there is
   a discrepancy, a sample rate converter is inserted automatically
   into the pipeline.

2. You must pass entire packets as returned by the encoder when you're
   decoding. Otherwise you can end up with errors. Errors in a stream
   are indicated by the `error:` field being present in the data received
   in the `onmessage` handler.

3. Only the `begin` messages determine the `sampleRate` and `numChannels`,
   which are frozen for the stream at that point.

4. The `end` messages can optionally pass a last buffer to process,
   but the `proc` messages **must** pass a buffer to process.

5. When encoding, there are no restrictions on the size of the sample
   buffer you need to pass. The buffer is automatically processed in
   opus-compatible blocks and the encoded packets for each such
   block are sent back. This means that if your buffer is large,
   you'll receive multiple `onmessage` calls for that one `postMessage`.
   Your `onmessage` handler must be prepared to deal with that.






