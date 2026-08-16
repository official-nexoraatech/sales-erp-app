package com.nexoraa.billtop;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

@SpringBootApplication
public class BillTopApplication {

	public static void main(String[] args) {
		loadDotEnv();
		SpringApplication.run(BillTopApplication.class, args);
	}

	/**
	 * Loads KEY=VALUE pairs from a local .env file (if present) into system properties so
	 * application.properties placeholders like ${MAIL_HOST} resolve without Docker/env_file.
	 * Real OS environment variables always take precedence over .env values.
	 */
	private static void loadDotEnv() {
		Path envFile = Path.of(".env");
		if (!Files.isReadable(envFile)) {
			return;
		}
		List<String> lines;
		try {
			lines = Files.readAllLines(envFile);
		} catch (IOException e) {
			return;
		}
		for (String line : lines) {
			String trimmed = line.trim();
			if (trimmed.isEmpty() || trimmed.startsWith("#")) {
				continue;
			}
			int separatorIndex = trimmed.indexOf('=');
			if (separatorIndex <= 0) {
				continue;
			}
			String key = trimmed.substring(0, separatorIndex).trim();
			String value = trimmed.substring(separatorIndex + 1).trim();
			if (System.getenv(key) == null && System.getProperty(key) == null) {
				System.setProperty(key, value);
			}
		}
	}

}
