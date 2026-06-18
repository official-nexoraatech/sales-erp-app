package com.nexoraa.billtop.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;

import java.time.LocalDateTime;

/**
 * Error Response wrapper for all error responses.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonInclude(JsonInclude.Include.NON_NULL)
public class ErrorResponseDto {

    private Boolean success;
    private String message;
    private String errorCode;
    private Object errors;
    private LocalDateTime timestamp;

    /**
     * Create an error response.
     */
    public static ErrorResponseDto error(String message, String errorCode) {
        return ErrorResponseDto.builder()
                .success(false)
                .message(message)
                .errorCode(errorCode)
                .timestamp(LocalDateTime.now())
                .build();
    }

    /**
     * Create an error response with details.
     */
    public static ErrorResponseDto error(String message, String errorCode, Object errors) {
        return ErrorResponseDto.builder()
                .success(false)
                .message(message)
                .errorCode(errorCode)
                .errors(errors)
                .timestamp(LocalDateTime.now())
                .build();
    }
}

