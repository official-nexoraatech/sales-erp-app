package com.nexoraa.billtop.exception;

/**
 * Exception thrown for bad/invalid requests.
 */
public class BadRequestException extends ApplicationException {

    public BadRequestException(String message) {
        super(message, "BAD_REQUEST");
    }

    public BadRequestException(String message, String errorCode) {
        super(message, errorCode);
    }
}

