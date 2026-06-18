package com.nexoraa.billtop.exception;

/**
 * Exception thrown when authentication fails or is missing.
 */
public class UnauthorizedException extends ApplicationException {

    public UnauthorizedException(String message) {
        super(message, "UNAUTHORIZED");
    }

    public UnauthorizedException(String message, String errorCode) {
        super(message, errorCode);
    }
}

