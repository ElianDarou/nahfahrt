import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

/** The backend address is public; it lives in the repository's .env.production. */
fun backendUrl(): String {
    System.getenv("NAHFAHRT_API_URL")?.let { return it.trimEnd('/') }
    val env = rootProject.file("../.env.production")
    val line = env.takeIf { it.exists() }?.readLines()
        ?.firstOrNull { it.startsWith("CONVEX_SITE_URL=") }
        ?: error("CONVEX_SITE_URL missing in .env.production")
    return line.substringAfter("=").trim().trimEnd('/')
}

val keystoreProperties = Properties().apply {
    val file = rootProject.file("keystore.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

android {
    namespace = "io.github.eliandarou.nahfahrt"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.github.eliandarou.nahfahrt"
        minSdk = 26
        targetSdk = 36
        versionCode = 6
        versionName = "0.5.1"
        buildConfigField("String", "API_URL", "\"${backendUrl()}\"")
    }

    signingConfigs {
        create("release") {
            if (keystoreProperties.isNotEmpty()) {
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (keystoreProperties.isNotEmpty()) signingConfig = signingConfigs.getByName("release")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "DebugProbesKt.bin", "kotlin-tooling-metadata.json")
    }

    dependenciesInfo {
        // Not on Google Play; the signing block only means something to Google.
        includeInApk = false
        includeInBundle = false
    }
}

kotlin {
    jvmToolchain(17)
    compilerOptions {
        // Material 3 Expressive is still marked experimental; the app uses it on purpose.
        optIn.addAll(
            "androidx.compose.material3.ExperimentalMaterial3Api",
            "androidx.compose.material3.ExperimentalMaterial3ExpressiveApi",
            "androidx.compose.foundation.layout.ExperimentalLayoutApi",
            "androidx.compose.foundation.ExperimentalFoundationApi",
        )
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.06.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    // Material 3 Expressive (public from 1.5): MaterialExpressiveTheme, button groups, loading and wavy indicators.
    implementation("androidx.compose.material3:material3:1.5.0-alpha08")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.core:core-splashscreen:1.2.0")
    implementation("androidx.profileinstaller:profileinstaller:1.4.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
    debugImplementation("androidx.compose.ui:ui-tooling")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
}
