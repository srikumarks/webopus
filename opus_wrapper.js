;(function (Module) {

    // String descriptions of error codes.
    function opus_strerror(error) {
        return (opus_strerror._cache[error] || (function () {
            var str = "";
            var errstr = Module._opus_strerror(error);
            var c;
            while ((c = Module.getValue(errstr++, 'i1')) !== 0) {
                str += String.fromCharCode(c);
            }
            return (opus_strerror._cache[error] = str);
        }()));
    }

    opus_strerror._cache = {};

    //////////////////////////////
    // The encoder.
    //
    // @param fs = sampling rate. For supported sampling rates, see `OpusEncoder.frameSizes`.
    // @param channels = number of channels. Must be 1 or 2.
    // @param application = 'voip', 'audio', or 'restricted low delay' (case insensitive)
    // 
    function OpusEncoder(fs, channels, application) {
        if (!OpusEncoder.frameSizes[fs]) {
            throw new Error('OpusEncoder does not support ' + fs + 'Hz, only the following - ' + Object.keys(OpusEncoder.frameSizes));
        }

        if (channels !== 1 && channels !== 2) {
            throw new Error('OpusEncoder supports only 1 or 2 channels');
        }

        var appKey = application.toLowerCase();
        if (!OpusEncoder.appTypes.hasOwnProperty(appKey)) {
            throw new Error('OpusEncoder: Unknown application type - ' + application);
        }

        var errptr = Module._malloc(4);
        var encoder = Module._opus_encoder_create(fs, channels, OpusEncoder.appTypes[appKey], errptr);
        var error = Module.getValue(errptr, 'i32');
        Module._free(errptr);
        if (!encoder || error !== 0) {
            if (encoder) {
                Module._opus_encoder_destroy(encoder);
            }
            throw new Error('OpusEncoder creation failed - ' + opus_strerror(error));
        }

        this._encoder = encoder;
        this._pcm = ta_malloc(2880 * channels, Float32Array);
        this._encbytes = ta_malloc(2880 * channels, Uint8Array);
        this._channels = channels;
        this._fs = fs;
        this.MAX_FRAMES = this._pcm.length / channels;
    }

    // Supported sampling rates and frame sizes.
    OpusEncoder.frameSizes = {
        // fs : { fs/400, fs/200, fs/100, fs/50, fs/25, 3fs/50 }
        8000 : {20: true, 40: true, 80: true, 160: true, 320: true, 480: true}, 
        12000 : {30: true, 60: true, 120: true, 240: true, 480: true, 720: true}, 
        16000 : {40: true, 80: true, 160: true, 320: true, 640: true, 960: true}, 
        24000 : {60: true, 120: true, 240: true, 480: true, 960: true, 1440: true}, 
        48000 : {120: true, 240: true, 480: true, 960: true, 1920: true, 2880: true}
    };

    // @return One of the supported sampling rates given an arbitrary
    // one. The intention is to determine the parameters of the sample
    // rate converter to be applied.
    OpusEncoder.supportedSamplingRate = function (sr) {
        if (sr <= 8000) return 8000;
        if (sr <= 12000) return 12000;
        if (sr <= 16000) return 16000;
        if (sr <= 24000) return 24000;
        return 48000;
    };

    function round(n) {
        return Math.round(n);
    }

    OpusEncoder.frameSizesForSamplingRate = function (sr) {
        var ssr = OpusEncoder.supportedSamplingRate(sr);
        return [ssr/400, ssr/200, ssr/100, ssr/50, ssr/25, 3*ssr/50].map(round);
    };

    OpusEncoder.frameSize = function (sr, len) {
        var ssr = OpusEncoder.supportedSamplingRate(sr);
        var slen = Math.round(len * ssr / sr);
        if (slen >= 3*ssr/50) return { sr: ssr, len: 3 * ssr / 50 };
        if (slen >= ssr/25) return { sr: ssr, len: ssr/25 };
        if (slen >= ssr/50) return { sr: ssr, len: ssr/50 };
        if (slen >= ssr/100) return { sr: ssr, len: ssr/100 };
        if (slen >= ssr/200) return { sr: ssr, len: ssr/200 };
        return { sr: ssr, len: ssr/400 };
    };

    // Types of applications depending on which Opus does sigproc and optimizations.
    // Use 'voip' for voice applications and 'audio' or 'music' for music.
    OpusEncoder.appTypes = {
        'voip': 2048,
        'audio': 2049,
        'music': 2049,
        'restricted low delay': 2051
    };


    //////////////////////////////
    // The encoder must be explicitly freed. Otherwise emscripten will leak memory.
    // 
    OpusEncoder.prototype.destroy = function () {
        Module._opus_encoder_destroy(this._encoder);
        ta_free(this._pcm);
        ta_free(this._encbytes);
        this._encoder = null;
        this._pcm = null;
        this._encbytes = null;
    };


    //////////////////////////////
    // Encodes the given PCM samples (interleaved if stereo). Only certain frame sizes are
    // possible depending on the sampling rate. For info on this, see `OpusEncoder.frameSizes`.
    // Returns the encoded packet as a Uint8Array.
    //
    // @param pcm = A Float32Array frame to be encoded. For supported frame sizes, see `OpusEncoder.frameSizes`.
    // @preturn A Uint8Array giving the packet data. You need to copy out this data before making another call
    // to encode(). If you don't, the data will be overwritten by the next encode() call.
    // 
    OpusEncoder.prototype.encode = function (pcm) {
        if (pcm.length > this._pcm.length) {
            throw new Error('OpusEncoder::encode -> pcm length must be smaller than internal buffer length - i.e. <= ' + this._pcm.length);
        }

        var frame_size = pcm.length / this._channels;

        if (!OpusEncoder.frameSizes[this._fs][frame_size]) {
            throw new Error('OpusEncoder::encode -> Supported frame sizes are ' + Object.keys(OpusEncoder.frameSizes[this._fs]));
        }

        this._pcm.set(pcm);
        var packetSizeOrError = Module._opus_encode_float(this._encoder, this._pcm._emptr, frame_size, this._encbytes._emptr, this._encbytes.length);
        if (packetSizeOrError < 0) {
            throw new Error('OpusEncoder::encode error - ' + opus_strerror(packetSizeOrError));
        }

        return this._encbytes.subarray(0, packetSizeOrError);
    };

    //////////////////////////////
    // The decoder.
    // 
    // @param fs = Sampling rate. Only some sampling rates are supported. See `OpusEncoder.frameSizes`.
    // @param channels = Number of channels. Must be 1 or 2.
    // 
    function OpusDecoder(fs, channels) {
        if (!OpusEncoder.frameSizes[fs]) {
            throw new Error('OpusDecoder does not support ' + fs + 'Hz, only the following - ' + Object.keys(OpusEncoder.frameSizes));
        }

        if (channels !== 1 && channels !== 2) {
            throw new Error('OpusDecoder supports only 1 or 2 channels');
        }

        var errptr = Module._malloc(4);
        var decoder = Module._opus_decoder_create(fs, channels, errptr);
        var error = Module.getValue(errptr, 'i32');
        Module._free(errptr);
        if (!decoder || error !== 0) {
            if (decoder) {
                Module._opus_decoder_destroy(decoder);
            }
            throw new Error('OpusDecoder creation failed - ' + opus_strerror(error));
        }

        this._decoder = decoder;
        this._pcm = ta_malloc(8192 * channels, Float32Array);
        this._decbytes = ta_malloc(16384 * channels, Uint8Array);
        this._channels = channels;
        this._fs = fs;
        this.MAX_PACKET_SIZE = this._decbytes.length;
    }


    //////////////////////////////
    // Decoder must be explicitly destroyed so emscripten doesn't leak memory.
    // 
    OpusDecoder.prototype.destroy = function () {
        Module._opus_decoder_destroy(this._decoder);
        ta_free(this._pcm);
        ta_free(this._decbytes);
        this._decoder = null;
        this._pcm = null;
        this._decbytes = null;
    };

    
    //////////////////////////////
    // Decodes the given packet.
    //
    // @param packet = A Uint8Array giving a packet that was encoded by OpusEncoder.
    //
    // @param fec = 0 or 1, indicating decoding of inband forward error correction info.
    // If you don't know anything about this, pass 0.
    // 
    // @return A Float32Array view of (possibly interleaved) decoded samples. Before
    // making another decode call, you need to copy this out to some another array,
    // or the data will be overwritten in the next decode call.
    //
    OpusDecoder.prototype.decode = function (packet, fec) {
        if (packet.length > this._decbytes.length) {
            // Realloc the internal copy buffer instead of raising
            // an exception. This branch should be an unusual one
            // given the reasonably large size of the internal
            // buffer in the first place.
            ta_free(this._decbytes);
            this._decbytes = ta_malloc(packet.length, Uint8Array);
        }

        this._decbytes.set(packet);
        var samplesDecoded = Module._opus_decode_float(this._decoder, this._decbytes._emptr, packet.length, this._pcm._emptr, this._pcm.length / this._channels, fec);
        if (samplesDecoded < 0) {
            throw new Error('OpusDecoder::decode error - ' + opus_strerror(samplesDecoded));
        }

        return this._pcm.subarray(0, samplesDecoded * this._channels);
    };

    module.exports.Encoder = global.OpusEncoder = OpusEncoder;
    module.exports.Decoder = global.OpusDecoder = OpusDecoder;

}(Module));

