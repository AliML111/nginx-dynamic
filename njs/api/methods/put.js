// Function to edit upstreams
function edit_upstreams(req, upstreamId, upstreamName) {
    var payloadData = validate.validate_input(req);
        try {

            // Check if id exists
            if(!upstreamName.get(upstreamId)){
                handler.response_handler(req, 404, 'Upstream ID ' + upstreamId + ' does not exist');
                return;
            }

            // Validate the payload data
            var validation = validate.validate_payload(payloadData);
            if (!validation.isValid) {
                handler.response_handler(req, 404, validation.message);
                return;
            }

            // Retrieve existing upstream data
            var existingData = JSON.parse(upstreamName.get(upstreamId));
            // Manually merge existing data with the provided fields using Object.assign
            const updatedData = Object.assign({}, existingData, payloadData);
            // Merge existing data with the provided fields
            // var updatedData = {};
            // for (var prop in existingData) {
            //     updatedData[prop] = existingData[prop];
            // }
            // for (var prop in payloadData) {
            //     updatedData[prop] = payloadData[prop];
            // }

            // Update the endpoint based on new data
            updatedData.endpoint = updatedData.scheme + '://' + updatedData.server + ':' + updatedData.port + updatedData.route;

            let stringified = JSON.stringify(updatedData);

            // Save the updated upstream data
            upstreamName.set(upstreamId, stringified);

            // if (upstreamName.get(upstreamName) == stringified){
                handler.response_handler(req, 200, "Upstream updated successfully", updatedData, null);
            // } else {
                // handler.response_handler(req, 500, "Something went wrong", null, null);
            // }

        } catch (e) {
            ngx.log(ngx.ERR, 'Error processing PUT request: ' + e.message);
            handler.response_handler(req, 500, 'Could not edit upstream');
        }
}

export default {
    edit_upstreams
}