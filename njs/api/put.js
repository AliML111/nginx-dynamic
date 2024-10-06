// Function to edit upstreams
function editUpstreams(req, upstreamId, upstreamName) {
    var payloadData = validate.validateInput(req);
        try {

            // Check if id exists
            if(!upstreamName.get(upstreamId)){
                ingress.responseHandling(req, 404, 'Upstream ID ' + upstreamId + ' does not exist');
                return;
            }

            // Validate the payload data
            var validation = validate.validatePayload(payloadData);
            if (!validation.isValid) {
                ingress.responseHandling(req, 404, validation.message);
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

            // Save the updated upstream data
            upstreamName.set(upstreamId, JSON.stringify(updatedData));

            // Construct the response object
            var response = {
                success: true,
                errors: [],
                messages: [],
                result: updatedData,
                result_info: null
            };

            // Set the Content-Type header and send the response
            req.headersOut['Content-Type'] = 'application/json';
            req.return(200, JSON.stringify(response));

        } catch (e) {
            ngx.log(ngx.ERR, 'Error processing PUT request: ' + e.message);
            ingress.responseHandling(req, 500, 'Could not edit upstream');
        }
}

export default {
    editUpstreams
}