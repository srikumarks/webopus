/** 
* Received messages are instructions to process encode or decode
* audio samples. The encode/decode processes are treated as
* "streams". Each stream is either an encoding pipeline or a
* decoding pipeline, depending on how it was started. Each stream
* has a distinct 'begin', 'process' and 'end' stage signified by
* the corresponding instruction. You may not switch a stream from
* encoding to decoding or vice versa midway. Once a stream is
* begun in a mode, it must continue in that mode till the end.
* Any contrary messages will simply be discarded.
*
* @note You may receive one or more messages in response to a
* message.
*
* {
*    op: 'begin' | 'proc' | 'end',
*    stream: 'random_unique_string',
*
*    // Only one of the two below can be non-null.
*    // Gives info about which mode the stream is in.
*    enc: Optional[Float32Array],
*    dec: Optional[Uint8Array],
*
*    // Values for the below two are ignored in messages
*    // sent after 'begin'.
*    numChannels: 1, // Only mono supported at the moment.
*    sampleRate: int // The sample rate of the given samples
*                    // or of the expected output.
*  },
*
*  Response structure -
*
*  {
*    stream: 'random_unique_string',
*
*    // If the stream is an encoding pipeline, then
*    // enc will be non-null. If it is a decoding pipeline,
*    // then dec will be non-null.
*    enc: Optional[Uint8Array],
*    dec: Optional[Float32Array],
*
*    // The following two will always be provided for convenience.
*    numChannels: 1,
*    sampleRate: int,
*
*    // If this is the last message that will be sent
*    // for this stream, then end will be true.
*    end: Optional[boolean],
*
*    // In case some error occurred, this field will be set to
*    // a string description of the error and all fields except
*    // `stream` will not be present. Once a stream encounters
*    // an error condition, it will automatically be closed
*    // and no further messages from that stream will be received.
*    error: Optional[String]
* }
*
*/

;(function () {

    /*
    if (!global.importScripts) {
        // This is not running as a web worker. So the following
        // code is irrelevant and should not be run. This is useful
        // if you're using the build as a normal library intended
        // to be merged into other code using a tool like
        // browserify. However, be aware that if the final binary
        // does get run in a web worker, you'll need to ensure that
        // your intended onmessage handler overrides this one.
        // Otherwise your handler will never get called and
        // the codec will be waiting for encoding/decoding messages
        // fruitlessly.
        return;
    }
    */

    var noSampleFrames = new Float32Array(0);
    var emptyPacket = new Uint8Array(0);

    function workerMessageHandler(event) {
        var msg = event.data, stream = getStream(msg.stream);

        switch (msg.op) {
            case 'begin':
                if (stream) {
                    closeStream(stream);
                }
                stream = createStream(msg);
                if (!stream) {
                    error(msg.stream, "Could not create stream.");
                    break;
                }
                if (stream.encoder) {
                    encodeSamples(stream, msg.enc, false);
                } else if (stream.decoder) {
                    decodePackets(stream, msg.dec, false);
                } else {
                    error(msg.stream, "Invalid stream mode.");
                }
                break;

            case 'proc':
                if (!stream) {
                    error(msg.stream, "Unknown stream");
                    break;
                }

                if (stream.encoder && msg.enc) {
                    encodeSamples(stream, msg.enc, false);
                } else if (stream.decoder && msg.dec) {
                    decodePackets(stream, msg.dec, false);
                } else {
                    error(msg.stream, "Invalid stream mode.");
                }
                break;
                
            case 'end':
                if (!stream) {
                    error(msg.stream, "Unknown stream");
                    break;
                }

                if (stream.encoder) {
                    encodeSamples(stream, msg.enc || noSampleFrames, true);
                } else if (stream.decoder) {
                    decodePackets(stream, msg.dec || emptyPacket, true);
                }
                closeStream(stream);
                break;

            default:
                console.error('Invalid message object received in webopus.');
                break;
        }
    }

    var OpusEncoder = module.exports.Encoder;
    var OpusDecoder = module.exports.Decoder;
    var SampleRateConverter = module.exports.SampleRateConverter;
    
    var all_streams = {};

    function getStream(id) {
        return all_streams[id];
    }

    function createStream(msg) {
        var stream = {
            id: msg.stream,
            numChannels: msg.numChannels,
            sampleRate: msg.sampleRate,
            opusSampleRate: 0,

            // We store a custom version of postMessage that can be
            // overridden from module.exports for testing purposes.
            // If not overidden, this will work exactly like the
            // global postMessage. We can't do this outside because
            // there wouldn't have been an opportunity for the loading
            // module to override postMessage like this. So we need to
            // do it lazily.
            postMessage: (module.exports.postMessage || global.postMessage).bind(global)
        };

        stream.opusSampleRate = OpusEncoder.supportedSamplingRate(msg.sampleRate);
        var needsConverter = (stream.opusSampleRate !== stream.sampleRate);

        if (msg.enc) {
            stream.encoder = new OpusEncoder(stream.opusSampleRate, stream.numChannels, 'music');

            // The number of samples to accumulate before we can do an encode.
            stream.block_frames = OpusEncoder.frameSize(stream.sampleRate, stream.sampleRate / 25).len;
            stream.block_len = stream.block_frames * stream.numChannels;

            // An array of Float32Buffer objects that are kept around
            // until we have enough to fill a block to pass to the encoder.
            stream.buffer = [];

            // The total number of samples in all the accumulated Float32Array
            // objects in the stream.buffer. We use this to tell when to pass
            // the buffers to the encoder.
            // 
            // buffer_len = numChannels * buffer_frames
            stream.buffer_len = 0;
            stream.buffer_frames = 0;
            
            if (needsConverter) {
                // Convert from given sample rate to opus-supported rate.
                var ratio = stream.opusSampleRate / stream.sampleRate;
                stream.converter = new SampleRateConverter('default', stream.numChannels, ratio);
            }
        } else if (msg.dec) {
            stream.decoder = new OpusDecoder(stream.opusSampleRate, stream.numChannels);
            if (needsConverter) {
                // Convert from opus supported rate to given rate.
                stream.converter = new SampleRateConverter('default', stream.numChannels, stream.sampleRate / stream.opusSampleRate);
            }
        }

        all_streams[stream.id] = stream;
        return stream;
    }

    function closeStream(stream) {
        if (!stream) {
            return;
        }
        if (stream.encoder) {
            stream.encoder.destroy();
        }
        if (stream.decoder) {
            stream.decoder.destroy();
        }
        if (stream.converter) {
            stream.converter.destroy();
        }
        delete all_streams[stream.id];
    }

    function error(id, description) {
        var stream = getStream(id);
        closeStream(stream);
        stream.postMessage({
            stream: id,
            error: description
        });
    }

    // Takes an array of Float32Array objects whose
    // total length is given by `len` and conctenates them
    // all into a single Float32Array.
    function consolidate(buffer, len) {
        var b = new Float32Array(len);
        for (var i = 0, offset = 0; i < buffer.length; ++i) {
            b.set(buffer[i], offset);
            offset += buffer[i].length;
        }
        return b;
    }

    function encodeSamples(stream, samples, the_end) {
        if (stream.converter) {
            // The sample rate converter returns buffer copies, so
            // we're safe with just storing them away.s
            var opusSamples = stream.converter.process(samples, the_end);
            stream.buffer.push.apply(stream.buffer, opusSamples);
            var len = 0;
            for (var i = 0; i < stream.buffer.length; ++i) {
                len += stream.buffer[i].length;
            }
            stream.buffer_frames = Math.round(len / stream.numChannels);
            stream.buffer_len = len;
        } else {
            stream.buffer.push(samples);
            stream.buffer_len += samples.length;
            stream.buffer_frames = Math.round(stream.buffer_len / stream.numChannels);
        }

        if (the_end && stream.buffer_len % stream.block_len > 0) {
            // We must flush the output by padding with zeroes.
            var padding = stream.block_len - stream.buffer_len % stream.block_len;
            stream.buffer.push(new Float32Array(padding));
            stream.buffer_len += padding;
            stream.buffer_frames = Math.round(stream.buffer_len / stream.numChannels);
        }

        if (stream.buffer_len >= stream.block_len) {
            if (stream.buffer.length > 1) {
                stream.buffer = [consolidate(stream.buffer, stream.buffer_len)];
            }
        } else {
            // Not yet enough samples to process.
            return;
        }

        // Invariant here is that stream.buffer.length will be 1.
        if (stream.buffer.length !== 1) {
            throw new Error("Unexpected buffer length " + stream.buffer.length + "!");
        }

        if (stream.buffer.length > 0 && stream.buffer[0].length > 0) {
            for (var blocks = stream.buffer[0]; blocks.length >= stream.block_len;) {
                // Note that subarray creates a new view of the underlying
                // ArrayBuffer and doesn't make a copy.
                var block = blocks.subarray(0, stream.block_len);
                var remBlocks = blocks.subarray(stream.block_len);

                // The encoder returns a view into its internal buffer.
                // We need to copy it after encoding so that we can
                // transfer it to the calling process in the postMessage.
                // As an alternative, we can do a postMessage without
                // mentioning a transfer list. I'm not sure about the
                // async consequences of that - i.e. whether the buffer
                // is expected to be available for use at an arbitrary
                // point in the future in case there is delay in the
                // sending. Making the copy explicit avoids that bit of
                // uncertainty while not costing anything more.
                var packet = new Uint8Array(stream.encoder.encode(block));

                stream.postMessage({
                    stream: stream.id,
                    enc: packet,
                    sampleRate: stream.sampleRate,
                    encSampleRate: stream.opusSampleRate,
                    numChannels: stream.numChannels,
                    end: the_end && remBlocks.length === 0
                }, [packet.buffer]);

                blocks = remBlocks;
            }
            
            stream.buffer = blocks.length > 0 ? [blocks] : [];
        } else if (the_end) {
            stream.postMessage({
                stream: stream.id,
                sampleRate: stream.sampleRate,
                encSampleRate: stream.opusSampleRate,
                numChannels: stream.numChannels,
                end: true
            });
        }
    }

    function decodePackets(stream, packets /* : Uint8Array */, the_end /* : boolean */) {
        // Note that the decoder returns a typed array view
        // over its internal buffer. If we are supposed to be done
        // at this point, we should copy it. However, if we
        // still have the sample rate converter to apply, we can
        // do that without a copy.
        var resultSamples = [packets && (packets.length > 0) ? stream.decoder.decode(packets, 0) : noSampleFrames];
        if (stream.converter) {
            // The converter returns independent copies. So no
            // additional copy necessary.
            resultSamples = stream.converter.process(resultSamples[0], the_end);
        } else {
            // No sample rate converter. Ensure
            // that the decoder internal buffer is
            // copied over so it can be sent to 
            // the calling process by ownership transfer.
            resultSamples[0] = new Float32Array(resultSamples[0]);
        }

        for (var i = 0; i < resultSamples.length; ++i) {
            stream.postMessage({
                stream: stream.id,
                dec: resultSamples[i],
                sampleRate: stream.sampleRate,
                encSampleRate: stream.opusSampleRate,
                numChannels: stream.numChannels,
                end: the_end && (i + 1 === resultSamples.length)
            }, [resultSamples[i].buffer]);
        }
    }

    global.onmessage = workerMessageHandler;
    module.exports.onmessage = workerMessageHandler;
}());
