;(function (Module) {

    // String descriptions of error codes.
    function src_strerror(error) {
        return (src_strerror._cache[error] || (function () {
            var str = "";
            var errstr = Module._src_strerror(error);
            var c;
            while ((c = Module.getValue(errstr++, 'i1')) !== 0) {
                str += String.fromCharCode(c);
            }
            return (src_strerror._cache[error] = str);
        }()));
    }

    src_strerror._cache = {};


    /**
    * Creates a sample rate converter that processes using the given ratio.
    * The converter is independent of the actual sample rate and only depends
    * on the ratio to determine the sinc function.
    *
    * Note that the converter may not be exact. For example, if you're converting
    * from 44100 to 48000 and you pass 48000/44100 as the ratio and a buffer 
    * consisting of 4410 samples, you may not exactly get 4800 samples in the output.
    * It may be 4799 or 4801, for instance. It is better to error on the excess
    * side and use a slightly larger ratio if you need to urgently fill buffers
    * for further processing. For example, you could use 48010/44100. However,
    * there are other problems you'll need to deal with in this case, such as
    * keeping track of the actual ratio so that your time stamps are all in order.
    *
    * @param type An enum in ['default', 'sinc fastest', 'zero order hold', 'linear']
    *             This chooses a type of sample rate converter with various tradeoffs.
    *             The 'default' choice is good. So stick with it unless you know
    *             what you want.
    *
    * @param channels 1 for mono and 2 for stereo. The channels are expected
    *          to be interleaved in the input and output.
    *
    * @param ratio This is the output sample rate / input sample rate ratio.
    *          For example, if you're converting from 44100Hz to 48000Hz, you
    *          give 48000/44100 here.
    *
    */
    function SampleRateConverter(type, channels, ratio) {
        var typenum = 0;
        switch (type) {
            case 'default': typenum = 2; break;
            case 'sinc fastest': typenum = 2; break;
            case 'zero order hold': typenum = 3; break;
            case 'linear': typenum = 4; break;
            default:
                throw new Error('Unsupported sample rate converter type ' + type);
        }
        var errorptr = Module._malloc(4);
        Module.setValue(errorptr, 0, 'i32');
        this._src_state = Module._src_new(typenum, channels, errorptr);
        this._src_ratio = ta_malloc(1, Float64Array);
        this._src_ratio[0] = ratio;
        var error = Module.getValue(errorptr, 'i32');
        Module._free(errorptr);
        if (error || !this._src_state) {
            throw new Error('Sample rate converter failed to initialize - error: ' + src_strerror(error));
        }

        this._frames_in = ta_malloc(4096 * channels, Float32Array);
        this._frames_out = ta_malloc(4096 * channels * ratio * 1.1, Float32Array);
        this._input_pos = 0;
        this._channels = channels;
        this._frames_proc = ta_malloc(1, Int32Array);
        this._frames_gen = ta_malloc(1, Int32Array);
    }


    /**
    * Once you're done with the converter, you MUST call the destroy()
    * method in order to free memory. Otherwise Emscripten will run
    * out of memory for any further operations ... at least eventually.
    */
    SampleRateConverter.prototype.destroy = function () {
        if (this._src_state) {
            Module._src_delete(this._src_state);
            ta_free(this._frames_in);
            ta_free(this._frames_out);
            ta_free(this._frames_proc);
            ta_free(this._frames_gen);
            ta_free(this._src_ratio);
            this._src_state = 0;
        }
    };

    /**
    * Processes the given input samples and returns an array of Float32Array
    * objects that are expected to be sequenced to get the final result.
    *
    * @param samples A Float32Array of input samples to convert.
    *
    * @param end_of_input A boolean indicating whether this will be the
    *      last call for this converter, so that it can flush any pending
    *      samples and return all the results it can.
    *
    * @return An array of Float32Array objects. This will depend on how
    *      large the input sample array is and whether this is the end of
    *      input.
    */
    SampleRateConverter.prototype.process = function (samples, end_of_input) {
        var result = [];
        if (samples.length % this._channels !== 0) {
            throw new Error('Invalid frame structure in sample array.');
        }
        var N = Math.round(samples.length / this._channels);
        var copied = 0;
        var eoi = end_of_input === undefined ? false : !!end_of_input;
        var eoi_step = 0;

        do {
            var n = Math.min(this._frames_in.length / this._channels, (this._input_pos + N - copied));
            this._frames_in.set(
                samples.subarray(
                    copied * this._channels, 
                    (copied + n - this._input_pos) * this._channels), 
                this._input_pos * this._channels);
            var res = Module._src_process_direct(
                this._src_state, 
                this._frames_in._emptr, n, this._frames_proc._emptr, 
                this._frames_out._emptr, this._frames_out.length / this._channels, this._frames_gen._emptr, 
                eoi_step, 
                this._src_ratio._emptr);
            if (res !== 0) {
                throw new Error('Conversion error - ' + src_strerror(res));
            }
            if (this._frames_gen[0] > 0) {
                result.push(new Float32Array(this._frames_out.subarray(0, this._frames_gen[0] * this._channels)));
            }
            copied += this._frames_proc[0] - this._input_pos;
            if (this._frames_proc[0] < n) {
                this._frames_in.set(this._frames_in.subarray(this._frames_proc[0] * this._channels), 0);
            }
            this._input_pos = n - this._frames_proc[0];
            eoi_step = (eoi && eoi_step === 0 && copied >= N) ? 1 : 0;
        } while (eoi_step || (copied < N && this._frames_gen[0] > 0));

        return result;
    };

    /**
    * Returns the number of sample frames pending to be returned even
    * if you passed zero samples to the converter in the next "process"
    * call.
    */
    SampleRateConverter.prototype.framesPending = function () {
        return this._input_pos;
    };

    module.exports.SampleRateConverter = global.SampleRateConverter = SampleRateConverter;

}(Module));
