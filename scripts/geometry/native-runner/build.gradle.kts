plugins {
  kotlin("jvm") version "2.0.21"
  application
}

repositories {
  mavenCentral()
}

dependencies {
  implementation(kotlin("stdlib"))
}

kotlin {
  jvmToolchain(21)
}

application {
  mainClass.set("expo.modules.lugincarddetector.GeometryNativeBatchKt")
}

// Compile the production DetectCard.kt sources — not a fork.
sourceSets {
  main {
    kotlin {
      srcDir("src/main/kotlin")
      srcDir("../../../mobile/modules/lugin-card-detector/android/src/main/java")
      exclude("**/LuginCardDetectorModule.kt")
    }
  }
}

tasks.register<JavaExec>("geometryBatch") {
  group = "lugin"
  description = "Batch DetectCard.detectFromRgba over GEOMETRY_NATIVE_BATCH_DIR"
  dependsOn("classes")
  classpath = sourceSets["main"].runtimeClasspath
  mainClass.set("expo.modules.lugincarddetector.GeometryNativeBatchKt")
}
