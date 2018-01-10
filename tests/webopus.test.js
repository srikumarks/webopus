
const webopus = require('../build/webopus.js');

describe('Export checks', () => {
    test('Encoder is exported', () => {
        expect(webopus.Encoder).not.toBeUndefined();
    });

    test('Decoder is exported', () => {
        expect(webopus.Decoder).not.toBeUndefined();
    });

    test('SampleRateConverter is exported', () => {
        expect(webopus.SampleRateConverter).not.toBeUndefined();
    });

    test('onmessage is exported', () => {
        expect(webopus.onmessage).not.toBeUndefined();
    });
});

describe('Availability checks', () => {
    test('Create and destroy 48KHz encoder', () => {
        let enc = new webopus.Encoder(48000, 1, 'music');
        enc.destroy();
    });

    test('Cannot create 44.1KHz encoder', () => {
        expect(() => { new webopus.Encoder(44100, 1, 'music'); }).toThrow();
    });

    test('Create and destroy 48KHz decoder', () => {
        let dec = new webopus.Decoder(48000, 1);
        dec.destroy();
    });

    test('Cannot create 44.1KHz decoder', () => {
        expect(() => { new webopus.Decoder(44100, 1); }).toThrow();
    });

    test('Create and destroy sample rate converter', () => {
        let src = new webopus.SampleRateConverter('default', 1, 48000/44100);
        src.destroy();
    });
});

describe('SampleRateConverter integration', () => {
    // It is not the responsibility of this test suite to actually
    // validate possible conversion ratios and accuracy, etc.
    // That is the responsibility of the respective libraries.
    // This suite therefore focuses on ensuring that our
    // intergration doesn't fail  - i.e. it assumes that if
    // a thumbrule signal comparison of output with known input
    // signal checks out fine, then the integration is fine.
    //
    // That said, we do check out the most common conversion
    // we expect to apply on the simplest of signals - sinusoid.
    let tolerance = 0.025;

    test('Convert 44.1KHz mono to 48KHz mono', () => {
        let src = new webopus.SampleRateConverter('default', 1, 48000/44100);
        let spec = {freq: 440, amp: 0.25};
        let sig_in = signal(44100, 1, 'tonal', spec);
        let sig_out = signal(48000, 1, 'tonal', spec);
        let proc = consolidate(src.process(sig_in, true));
        src.destroy();
        expect(sig_diff(proc, sig_out)).toBeLessThan(tolerance);
    });

    test('Convert 48KHz mono to 44.1KHz mono', () => {
        let src = new webopus.SampleRateConverter('default', 1, 44100/48000);
        let spec = {freq: 440, amp: 0.25};
        let sig_in = signal(48000, 1, 'tonal', spec);
        let sig_out = signal(44100, 1, 'tonal', spec);
        let proc = consolidate(src.process(sig_in, true));
        src.destroy();
        expect(sig_diff(proc, sig_out)).toBeLessThan(tolerance);
    });
});

describe('Opus codec integration', () => {

    test('Enc -> Dec at 48KHz is an identity', () => {
        let spec = {freq: 960, amp: 0.25};
        let sig_in = signal(48000, 960/48000, 'tonal', spec);
        let encoder = new webopus.Encoder(48000, 1, 'music');
        let packets = encoder.encode(sig_in);
        encoder.destroy();

        expect(packets).not.toBeUndefined();
        expect(packets.length).toBeGreaterThan(2);
        
        // Check that some reasonable compression has actually
        // happened. We use 20% of mono 16-bits/sample data size
        // as a loose threshold.
        expect(packets.length).toBeLessThan(0.2 * sig_in.length * 2);
        
        let decoder = new webopus.Decoder(48000, 1);
        let sig_out = decoder.decode(packets);
        decoder.destroy();

        // We need to be super lenient in this because energy differences
        // can be large and there aren't enough zero crossings in this
        // one packet to do a tighter check. For this purpose, all we
        // care about is that the signals aren't widely apart. If there is
        // some stupid failure in integration, this will blow up in a
        // phenomenal way and not merely express itself as an error
        // discrepancy of 0.1.
        expect(sig_diff(sig_in, sig_out)).toBeLessThan(0.25);
    });
    
});

describe('Worker interface (synchronous)', () => {
    let encDecTest = (SR, dur, freq, tolerance) => {
        let streamID = 'test1_' + SR;
        let packets = [];
        let done = false;
        let spec = {freq: freq, amp: 0.25};

        // Set an explicit postMessage function so that it will be
        // called back with data that we can collect and examine
        // synchronously.
        webopus.postMessage = (data, transferables) => {
            expect(data.stream).toBe(streamID);
            expect(data.error).toBeUndefined();
            if (data.packet) {
                expect(data.packet.length).toBeGreaterThan(0);
                expect(data.sampleRate).toBe(SR);
                expect(data.numChannels).toBe(1);

                packets.push(data.packet);
            } else {
                expect(data.end).toBe(true);
            }
            done = !!data.end;
        };

        let sig_in = signal(SR, dur, 'tonal', spec);
        expect(sig_in.length).toBe(Math.round(SR * dur));

        // Due to the way we're setting the postMessage
        // function to our own, it will be called synchronously
        // within the onmessage call below.
        webopus.onmessage({data: {
            op: 'begin',
            stream: streamID,
            frames: sig_in,
            sampleRate: SR,
            numChannels: 1
        }});

        webopus.onmessage({data: {
            op: 'end',
            stream: streamID,
            end: true
        }});

        expect(done).toBe(true);

        let byteLength = 0;
        for (let i = 0; i < packets.length; ++i) {
            expect(packets[i].length).toBeGreaterThan(0);
            byteLength += packets[i].length;
        }

        // Expect some compression. We're using a relaxed 20% value,
        // which is ok, since all we want to ensure is that the
        // integration code is working smoothly. Our intention is
        // not to test the encoder itself.
        expect(byteLength / (dur * SR * 2)).toBeLessThan(0.2);
        
        let avgBitRate = byteLength * 8 / dur;
        expect(avgBitRate).toBeGreaterThan(50000);
        expect(avgBitRate).toBeLessThan(70000);

        // ------------------------
        // Now decode the packets.

        let decodedSamples = [];
        done = false;
        webopus.postMessage = (data, transferables) => {
            expect(data.stream).toBe(streamID + '_dec');
            expect(data.error).toBeUndefined();
            if (data.frames) {
                expect(data.frames.length).toBeGreaterThan(-1);
                expect(data.sampleRate).toBe(SR);
                expect(data.numChannels).toBe(1);
                decodedSamples.push(data.frames);
            } else {
                expect(data.end).toBe(true);
            }
            done = !!data.end;
        };

        // As before, we're expecting synchronous callbacks to
        // out postMessage function. This isn't true in the
        // actual worker scenario, but will do for the integration
        // test.
        for (let p = 0; p < packets.length; ++p) {
            webopus.onmessage({data: {
                op: p === 0 ? 'begin' : 'proc',
                stream: streamID + '_dec',
                sampleRate: SR,
                numChannels: 1,
                packet: packets[p]
            }});
        }

        webopus.onmessage({data: {
            op: 'end',
            stream: streamID + '_dec',
            sampleRate: SR,
            numChannels: 1
        }});

        expect(done).toBe(true);
        expect(decodedSamples.length).not.toBeLessThan(packets.length);

        // Roughly similar in length - need to be quite strict.
        let sig_out = consolidate(decodedSamples);
        expect(Math.abs(sig_in.length - sig_out.length) / sig_in.length).toBeLessThan(tolerance);
        expect(sig_diff(sig_in, sig_out)).toBeLessThan(tolerance);
    };

    test('Enc -> Dec at 48KHz', () => { encDecTest(48000, 2.0, 480, 0.02); });
    test('Enc -> Dec at 44.1KHz', () => { encDecTest(44100, 2.0, 480, 0.02); });
    test('Enc -> Dec at 48KHz (typical)', () => { encDecTest(48000, 20.0, 600, 0.02); });
    test('Enc -> Dec at 44.1KHz (typical)', () => { encDecTest(44100, 20.0, 600, 0.02); });
});

// Creates signals for test purposes.
// @param fs Sampling rate in Hz
// @param dur Duration of signal in seconds.
// @param type Enum of "tonal"
// @param params Object giving parameters specific to type.
//        For "tonal", { freq: 440, amp: 0.25 }
function signal(fs, dur, type, params) {
    let len = Math.ceil(fs * dur);
    let buff = new Float32Array(len);
    switch (type) {
        case 'tonal':
            for (let i = 0; i < len; ++i) {
                buff[i] = params.amp * Math.sin(2 * Math.PI * params.freq * i / fs);
            }
            return buff;
        case 'noise':
            for (let i = 0; i < len; ++i) {
                buff[i] = params.amp * Math.random();
            }
            return buff;
        default:
            throw new Error("Unknown signal type '" + type + "'");
    }
}

// Takes an array of Float32Array objects whose
// total length is given by `len` and conctenates them
// all into a single Float32Array.
function consolidate(buffers) {
    let len = 0;
    for (let i = 0; i < buffers.length; ++i) {
        len += buffers[i].length;
    }
    let b = new Float32Array(len);
    for (let i = 0, offset = 0; i < buffers.length; ++i) {
        b.set(buffers[i], offset);
        offset += buffers[i].length;
    }
    return b;
}

function energy(sig) {
    let e = 0;
    for (let i = 0; i < sig.length; ++i) {
        e += sig[i] * sig[i];
    }
    return e;
}

function zero_crossings(sig) {
    let zc = 0;
    for (let i = 2; i < sig.length; ++i) {
        if (sig[i-2] * sig[i] < 0) {
            zc++;
        }
    }
    return zc;
}

function sig_diff(sig1, sig2) {
    let e1 = energy(sig1), e2 = energy(sig2);
    let zc1 = zero_crossings(sig1), zc2 = zero_crossings(sig2);

    let s1 = Math.abs(e1 - e2) / (0.5 * (e1 + e2));
    let s2 = Math.abs(zc1 - zc2) / (0.5 * (zc1 + zc2));
    //console.log("l1", sig1.length, "l2", sig2.length);
    //console.log("e1", e1, "zc1", zc1, "e2", e2, "zc2", zc2, "energy =", s1, "zero crossings =", s2);
    let diff = 0.25 * s1 + 0.75 * s2;
    // console.log("diff", diff);
    return diff;
}




