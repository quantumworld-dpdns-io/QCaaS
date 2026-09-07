"""Domain errors. The API layer maps these to HTTP responses."""


class QCaaSError(Exception):
    code = "qcaas_error"
    http_status = 400

    def __init__(self, message: str, detail: str | None = None):
        super().__init__(message)
        self.message = message
        self.detail = detail


class UnsupportedFormat(QCaaSError):
    code = "unsupported_format"
    http_status = 422


class InvalidCircuit(QCaaSError):
    code = "invalid_circuit"
    http_status = 422


class BackendNotFound(QCaaSError):
    code = "backend_not_found"
    http_status = 404


class NotApplicable(QCaaSError):
    """A backend cannot process this input (e.g. Classiq without a Qmod model)."""

    code = "not_applicable"
    http_status = 422


class BackendUnavailable(QCaaSError):
    code = "backend_unavailable"
    http_status = 503


class ExecutionNotAllowed(QCaaSError):
    code = "execution_not_allowed"
    http_status = 403
