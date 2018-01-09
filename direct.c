

/**
 * This is a straight forward wrapper for the src_process()
 * function so that we don't have to deal with creating and
 * filling up the SRC_DATA structure in Javascript just to
 * call src_process().
 */
int src_process_direct(
            SRC_STATE *state,
            float *data_in, long frames_in, long *frames_in_used,
            float *data_out, long frames_out,  long *frames_out_gen,
            int end_of_input,
            double *ratio
        ) 
{
    SRC_DATA data;
    data.data_in = data_in;
    data.data_out = data_out;
    data.input_frames = frames_in;
    data.output_frames = frames_out;
    data.end_of_input = end_of_input;
    data.src_ratio = *ratio;

    {
        int result = src_process(state, &data);
        (*frames_in_used) = data.input_frames_used;
        (*frames_out_gen) = data.output_frames_gen;
        return result;
    }
}

